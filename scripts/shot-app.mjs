/**
 * The Electron half of the screenshot generator. Launched by scripts/gen-shots.ts.
 *
 * ## Why Electron and not headless Chrome
 *
 * `node_modules/electron` exports the path to a version-pinned binary that
 * `npm install` already put there, so there is nothing for a contributor to
 * install and no `/Applications/Google Chrome.app` to hardcode. It is also what
 * the product actually is — the popover in these pictures is rendered by the
 * same engine that renders it on a user's machine. CDP over Node 22's built-in
 * WebSocket would also work; it was rejected because it needs a Chrome that may
 * not exist, a --user-data-dir dance to avoid handing off to a running Chrome,
 * and DevToolsActivePort polling, all to arrive at the same place.
 *
 * ## Why this file is .mjs and shotdata is .ts
 *
 * Electron's main process cannot run TypeScript — there is no
 * --experimental-strip-types passthrough. Anything that imports server/*.ts has
 * to stay on the Node side, so the payloads arrive through a JSON file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme, session } from 'electron';

const BASE = process.env.SHOT_BASE;
const DATA = process.env.SHOT_DATA;
const OUT = process.env.SHOT_OUT;
if (!BASE || !DATA || !OUT) throw new Error('shot-app: SHOT_BASE / SHOT_DATA / SHOT_OUT required');

const PRELOAD = path.join(import.meta.dirname, 'shot-preload.cjs');
const PANEL = { width: 420, height: 760 };

// Bitmap fonts and pixel art must be captured at 1x. A 2x capture resamples
// Galmuri's glyphs and every sprite into mush — the exact thing src/index.css
// turns antialiasing off to prevent. Belt and braces: the size is asserted
// after every capture too, because a flag that silently fails to apply would
// otherwise ship blurry pictures.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-lcd-text');
app.commandLine.appendSwitch('font-render-hinting', 'none');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a JS predicate in the page until it is true, or throw naming it. */
async function until(win, expr, what, timeoutMs = 15_000, everyMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await win.webContents.executeJavaScript(`Boolean(${expr})`);
    } catch {
      ok = false; // navigation in flight
    }
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`shot-app: timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/**
 * Describe an element as the compositor sees it.
 *
 * `querySelector(...)` being non-null is a weaker claim than it looks: the
 * region sign passed that check on the first run and painted nothing at all.
 * Anything the picture depends on gets asserted through here instead.
 */
async function boxOf(win, sel) {
  const raw = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ missing: true });
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return JSON.stringify({
      w: r.width, h: r.height, x: r.x, y: r.y,
      opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
      text: (el.textContent || '').trim().slice(0, 40),
    });
  })()`);
  return JSON.parse(raw);
}

/**
 * Wait out an element's own entrance animation.
 *
 * Not `document.getAnimations()` — the scene has looping animations (the two
 * grass layers, the egg wobble) that are never 'finished', so a document-wide
 * check would hang forever. Scoping to the element asks the only question that
 * matters: has THIS thing finished arriving.
 */
async function untilStill(win, sel, what) {
  await until(
    win,
    `document.querySelector(${JSON.stringify(sel)})
       ?.getAnimations().every((a) => a.playState === 'finished')`,
    `${what} to finish animating`,
    5_000,
    25,
  );
}

async function assertVisible(win, sel, what) {
  const b = await boxOf(win, sel);
  const bad =
    b.missing ||
    b.w < 1 ||
    b.h < 1 ||
    Number(b.opacity) < 0.9 ||
    b.visibility === 'hidden' ||
    b.display === 'none';
  if (bad) {
    throw new Error(`shot-app: ${what} is not visible — ${JSON.stringify(b)}`);
  }
  return b;
}

/**
 * Everything on screen has finished arriving.
 *
 * The visibility check is the important half. DexSprite (src/App.tsx:467),
 * SceneSprite (src/Scene.tsx:382) and PetApp's Sprite all render an <img> with
 * inline visibility:hidden until onLoad has measured it, so `complete` alone
 * would let a capture land on a grid of invisible cards.
 */
const SETTLED = `
  document.readyState === 'complete'
  && document.fonts.status === 'loaded'
  && [...document.images].every((i) => i.complete && i.naturalWidth > 0)
  && ![...document.images].some((i) => i.style.visibility === 'hidden')
`;

function makeWindow({ width, height, transparent = false }) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    // 420x760 of CONTENT, matching electron/main.ts:319-321. Without this the
    // frame would be subtracted and every shot would be a few pixels short.
    useContentSize: true,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#f6f5f1',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      // A hidden window throttles timers and rAF, which would leave the battle
      // phase chain crawling and every wait timing out mid-animation.
      backgroundThrottling: false,
      additionalArguments: [`--shot-data=${DATA}`],
    },
  });
  // Shown, but off every display: the renderer runs at full speed and nothing
  // appears in front of whoever is running the generator.
  win.setPosition(-4000, -4000);
  win.showInactive();
  return win;
}

/**
 * src/main.tsx reads location.hash at module load, so '/' -> '/#pet' is a
 * same-document hash change and the app never re-mounts. Every shot therefore
 * gets a unique query string to force a real navigation.
 */
let nav = 0;
const urlFor = (hash) => `${BASE}/?shot=${++nav}${hash}`;

async function capture(win, name, rect) {
  const img = rect ? await win.webContents.capturePage(rect) : await win.webContents.capturePage();
  const size = img.getSize();
  if (!rect && (size.width !== PANEL.width || size.height !== PANEL.height)) {
    throw new Error(
      `shot-app: ${name} captured at ${size.width}x${size.height}, expected ` +
        `${PANEL.width}x${PANEL.height}. force-device-scale-factor did not apply; ` +
        `the image would be resampled and the pixel art ruined.`,
    );
  }
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, img.toPNG());
  console.log(`  ${name}.png  ${size.width}x${size.height}`);
  return file;
}

/** Tab ids are `tab-${id}` (src/App.tsx:1274) — far steadier than label text. */
async function openTab(win, id) {
  await win.webContents.executeJavaScript(`document.getElementById('tab-${id}').click()`);
  await until(win, SETTLED, `tab ${id} to settle`);
  await sleep(250);
}

async function loadPanel(win, hash = '') {
  await win.loadURL(urlFor(hash));
  // The tablist only exists once state has arrived; until then App renders
  // '스캔 중…' (src/App.tsx:1006). So this doubles as proof the stub worked.
  await until(win, `document.querySelector('[role="tablist"]')`, 'the panel to mount');
  await until(win, SETTLED, 'the panel to settle');
  await sleep(250);
}

async function run() {
  nativeTheme.themeSource = 'light';

  /*
   * The hard privacy guard.
   *
   * The preload's fetch stub is the first line, this is the one that cannot be
   * regressed by an edit to it: /api/* is cancelled at the session level, so
   * the real buildState — which would read ~/.claude transcripts and the
   * owner's save — is unreachable no matter what the page asks for. Anything
   * off-origin is cancelled too, so no screenshot can contain something
   * fetched from the internet at capture time.
   */
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    // Vite's HMR socket is same-host but ws:, and blocking it only produces
    // console noise that buries real errors.
    const wsBase = BASE.replace(/^http/, 'ws');
    const remote = /^(https?|wss?):/.test(details.url);
    // Only a real network scheme can reach /api or the internet. data: and
    // about: are in-page and are what the hero composite draws from.
    const allowed =
      !remote || details.url.startsWith(BASE) || details.url.startsWith(wsBase);
    cb({ cancel: !allowed || details.url.includes('/api/') });
  });

  const win = makeWindow(PANEL);
  const written = [];

  // 1 · 파트너 — the travel scene, the portrait, the growth gauge.
  await loadPanel(win);
  // The sign slides in over 0.55s (sign-in, Scene.css:900). Capturing before
  // it lands gives a half-faded sign at a negative x — which is exactly what
  // the first run produced, silently.
  await untilStill(win, '.scene-sign', 'the region sign');
  await assertVisible(win, '.scene-sign', 'the region sign');
  written.push(await capture(win, '01-partner'));

  // 2 · 배틀. Scene arms on the first payload and only plays when a strictly
  // newer seq arrives (src/Scene.tsx:498-506), which is why there are two
  // payloads rather than one with a battle already in it.
  await win.webContents.executeJavaScript(`window.__shot.state = 'B'`);
  // The panel polls /api/state every 5s (src/App.tsx:914); no faking timers.
  await until(win, `document.querySelector('.scene-battle')`, 'the battle to start', 12_000);
  // Exactly one turn in the demo battle is super-effective, so this string
  // appears on exactly one 750ms beat — an unambiguous frame to shoot.
  await until(
    win,
    `document.querySelector('.scene-text')?.textContent.includes('효과가 굉장했다!')`,
    'the super-effective beat',
    12_000,
    16,
  );
  await sleep(180); // let the keyed .scene-fx animation open
  written.push(await capture(win, '02-battle'));

  // 3 · 도감 그리드
  await loadPanel(win);
  await openTab(win, 'dex');
  written.push(await capture(win, '03-dex'));

  // 4 · 도감 상세
  await win.webContents.executeJavaScript(
    `document.querySelector('.dex .card[data-key="6-n"]').click()`,
  );
  await until(win, `document.querySelector('.dexflavor')`, 'the dex entry screen');
  await until(win, SETTLED, 'the dex entry to settle');
  await sleep(250);
  written.push(await capture(win, '04-dex-entry'));

  // 5 · 상점
  await loadPanel(win);
  await openTab(win, 'shop');
  written.push(await capture(win, '05-shop'));

  // 6 · 업적
  await loadPanel(win);
  await openTab(win, 'awards');
  written.push(await capture(win, '06-awards'));

  // 7 · 떠 있는 펫, on a genuinely transparent page.
  //
  // Created BEFORE the panel is destroyed: the first run failed with
  // ERR_FAILED loading this URL, and leaving no live window even briefly is
  // the cheapest suspect to eliminate.
  const pet = makeWindow({ width: 360, height: 360, transparent: true });
  await pet.loadURL(urlFor('#pet'));
  await until(pet, `document.querySelector('.pet-sprite')`, 'the pet sprite');
  await until(pet, SETTLED, 'the pet to settle');
  // The HUD (name + % + today's tokens) only renders on hover, and it is much
  // the better sell than a bare sprite.
  const box = JSON.parse(
    await pet.webContents.executeJavaScript(
      `JSON.stringify(document.querySelector('.pet-anchor').getBoundingClientRect())`,
    ),
  );
  pet.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  });
  await until(pet, `document.querySelector('.pet-hud')`, 'the hover HUD');
  await sleep(250);
  /*
   * Crop the UNION of the sprite and the HUD.
   *
   * .pet-anchor is the sprite's box and the HUD pill hangs outside it, so
   * cropping to the anchor clipped the head and squeezed the HUD — which is
   * what the first successful run produced. Ask for both boxes and take their
   * envelope; 10px of padding covers .pet-sprite's drop-shadow (PetApp.css:55),
   * which paints outside the element either way.
   */
  const union = JSON.parse(
    await pet.webContents.executeJavaScript(`(() => {
      const els = ['.pet-sprite', '.pet-hud']
        .map((s) => document.querySelector(s))
        .filter(Boolean);
      const rs = els.map((e) => e.getBoundingClientRect());
      return JSON.stringify({
        x: Math.min(...rs.map((r) => r.left)),
        y: Math.min(...rs.map((r) => r.top)),
        right: Math.max(...rs.map((r) => r.right)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
        n: rs.length,
      });
    })()`),
  );
  if (union.n !== 2) throw new Error('shot-app: pet sprite or HUD missing at crop time');
  const pad = 10;
  const rect = {
    x: Math.max(0, Math.floor(union.x - pad)),
    y: Math.max(0, Math.floor(union.y - pad)),
    width: Math.ceil(union.right - union.x + pad * 2),
    height: Math.ceil(union.bottom - union.y + pad * 2),
  };
  written.push(await capture(pet, '07-pet', rect));

  // Transparency is the one genuinely uncertain step: a never-shown transparent
  // window can come back opaque. Colour type 6 is RGBA in the PNG IHDR, which
  // is byte 25 of the file.
  const png = readFileSync(written[written.length - 1]);
  if (png[25] !== 6) {
    throw new Error(
      `shot-app: 07-pet.png has PNG colour type ${png[25]}, expected 6 (RGBA). ` +
        `The transparent capture came back opaque.`,
    );
  }

  pet.destroy();

  /*
   * 0 · 히어로 — the panel and the desktop pet in one picture.
   *
   * Composed in the renderer rather than in Node: a canvas with
   * imageSmoothingEnabled=false gives exact nearest-neighbour scaling, which is
   * the only kind pixel art survives, and it needs no PNG encoder here. The
   * pet is drawn at 2x so it reads beside a 420px panel instead of vanishing.
   */
  const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const load = (src) => new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error('hero: image failed to decode'));
      i.src = src;
    });
    const panel = await load(${JSON.stringify(b64(readFileSync(written[0])))});
    const pet = await load(${JSON.stringify(b64(readFileSync(written[6])))});
    const SCALE = 2, GAP = 40;
    const pw = pet.width * SCALE, ph = pet.height * SCALE;
    const c = document.createElement('canvas');
    c.width = panel.width + GAP + pw;
    c.height = panel.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(panel, 0, 0);
    g.drawImage(pet, panel.width + GAP, Math.round((c.height - ph) / 2), pw, ph);
    return c.toDataURL('image/png');
  })()`);
  const heroFile = path.join(OUT, '00-hero.png');
  writeFileSync(heroFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  00-hero.png  composed`);
  written.push(heroFile);

  win.destroy();
  return written;
}

app.whenReady().then(async () => {
  try {
    const written = await run();
    console.log(`\n${written.length} shots written to ${OUT}`);
    app.exit(0);
  } catch (err) {
    console.error(`\n${err.message}`);
    app.exit(1);
  }
});
