import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  nativeTheme,
  protocol,
  screen,
  shell,
  Tray,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, saveState } from '../server/store.ts';
import { buy, consumeItem, type ItemId, type ProductId } from '../server/shop.ts';
import { forget, setHuntEnabled, setHuntUncapped, teach } from '../server/hunt.ts';
import { rename, setShowBattleForm } from '../server/game.ts';
import { fuseShards, hatchLegendEgg, spendLegendItem } from '../server/legends.ts';
import {
  REFRESH_MS, buildState, dexIndex, type PetState } from '../server/state.ts';
import { dexEntry } from '../server/dexentry.ts';
import { MAX_PET_WINDOW } from '../src/pixelFit.ts';
import {
  contentTypeFor,
  ensureStaticSprite,
  pruneCache,
  readSprite,
  spritePath,
} from '../server/sprites.ts';
import { appDataDir } from '../server/paths.ts';
import { DEFAULT_PREFS, PET_SIZES, loadPrefs, nearestSize, savePrefs, stepSize, type Prefs } from './state.ts';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let pet: BrowserWindow | null = null;
let prefs: Prefs = { ...DEFAULT_PREFS };
let refreshTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------- data

let cache: { at: number; payload: PetState } | null = null;
let inflight: Promise<PetState> | null = null;


async function getState(force = false): Promise<PetState> {
  if (cache && !force && Date.now() - cache.at < REFRESH_MS) return cache.payload;
  if (inflight) return inflight;
  inflight = buildState()
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Reads the accrued counter rather than rescanning: accrual happens in exactly
// one place (`buildState`), so a purchase charges against the same wallet the
// user was looking at, and does not pay a few seconds of scan to say "no".
async function runShopAction(action: string, id: string, slot: number | null = null) {
  const state = await loadState();
  const earned = state.lifetimeEarned;

  const result =
    action === 'buy'
      ? buy(state, id as ProductId, earned)
      : action === 'use'
        ? consumeItem(state, id as ItemId, earned, slot)
        : action === 'teach'
          ? teach(state, Number(id), slot)
          : action === 'forget'
            ? forget(state, Number(id))
            : action === 'hunt'
              ? setHuntEnabled(state, id === 'on')
              : action === 'huntcap'
                ? setHuntUncapped(state, id === 'off')
                : action === 'rename'
                  ? rename(state, id)
                  : action === 'form'
                    ? setShowBattleForm(state, id === 'on')
                    : action === 'legend'
                      ? spendLegendItem(state, id)
                      : action === 'legendegg'
                        ? hatchLegendEgg(state, Number(id))
                        : action === 'fuse'
                          ? fuseShards(state, id)
                          : { state, ok: false, message: '알 수 없는 요청입니다.' };

  if (action === 'sprites') return clearSprites();

  if (result.ok) {
    await saveState(result.state);
    // Force the next poll to reflect it immediately. Without this a move you
    // just taught stays invisible for a full refresh interval.
    cache = null;
  }
  return { ok: result.ok, message: result.message };
}

/**
 * Drop the sprite cache, keeping whatever is on screen.
 *
 * The battle scene shows whichever wild Pokemon turned up, so the cache creeps
 * toward the whole dex. Wiping everything would blank the panel until the next
 * refresh re-downloaded it, which reads as breakage rather than housekeeping.
 */
async function clearSprites() {
  const { removed, bytes } = await pruneCache(cache?.payload.keepSprites ?? []);
  cache = null;
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return {
    ok: true,
    message: removed ? `${removed}개 · ${mb}MB를 지웠습니다.` : '지울 것이 없습니다.',
  };
}

// ---------------------------------------------------------------- tray

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(n);

/**
 * Tray icon budget. macOS gives the menu bar 22pt of height; Windows is happy
 * with the same. Width gets a little more room for wide Pokemon.
 */
const TRAY_MAX_H = 22;
const TRAY_MAX_W = 30;

/**
 * Trim fully transparent margins.
 *
 * Static sprites are 96x96 canvases with the creature floating in the middle —
 * Litleo is only 40x47 of that. Scaling the whole canvas into 22px leaves about
 * 8px of visible Pokemon, which is why it reads as a smudge. Cropping first
 * lets the creature use the entire icon.
 */
function cropTransparent(img: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = img.getSize();
  if (!width || !height) return img;
  const bmp = img.toBitmap(); // BGRA, row-major
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Ignore near-transparent pixels; some sprites have faint halos.
      if (bmp[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return img; // fully transparent — nothing to crop
  return img.crop({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
}

/** What the tray is currently showing — surfaced in the startup log. */
let trayIconSource = 'egg glyph';

/**
 * The current companion, drawn into the tray.
 *
 * Deliberately NOT a template image: a template is flattened to a silhouette,
 * which would turn every Pokemon into the same black blob. Colour it is.
 * Returns null before the first hatch so the egg template stays.
 */
async function companionTrayImage(s: PetState) {
  // `displayId`, not `speciesId`: a fused companion should look fused in the
  // tray too, and the flat 96x96 PNG exists for form ids as well.
  const id = s.companion?.displayId;
  if (!id) return null;
  const name = await ensureStaticSprite(id, s.companion!.isShiny);
  if (!name) return null;
  const img = nativeImage.createFromPath(spritePath(name));
  if (img.isEmpty()) return null;

  const cropped = cropTransparent(img);
  const { width: w, height: h } = cropped.getSize();
  if (!w || !h) return null;
  // Fit inside the budget, whichever side binds first, keeping the aspect.
  const scale = Math.min(TRAY_MAX_W / w, TRAY_MAX_H / h);
  const scaled = cropped.resize({
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    quality: 'good',
  });
  scaled.setTemplateImage(false);
  return scaled;
}

function trayImage() {
  if (isMac) {
    // Template images are pure black + alpha; macOS inverts them for dark mode
    // and for the pressed state. A colour icon here would look broken.
    const img = nativeImage.createFromPath(path.join(process.resourcesPath ?? '', 'trayTemplate.png'));
    const fallback = nativeImage.createFromPath(path.join(__dirname_, '../build/trayTemplate.png'));
    const chosen = img.isEmpty() ? fallback : img;
    chosen.setTemplateImage(true);
    return chosen;
  }
  // Windows does not auto-invert, and Win11 taskbars can be either shade.
  const variant = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const packaged = nativeImage.createFromPath(path.join(process.resourcesPath ?? '', `tray-win-${variant}.ico`));
  if (!packaged.isEmpty()) return packaged;
  return nativeImage.createFromPath(path.join(__dirname_, `../build/tray-win-${variant}.ico`));
}

async function refreshTray() {
  if (!tray) return;
  try {
    const s = await getState();
    const label = s.companion ? s.companion.name : '알';
    const pct = Math.round(s.progress.ratio * 100);
    const tokens = compact(s.tokens.today);

    // Show whoever is currently being raised, falling back to the egg glyph.
    const companionIcon = await companionTrayImage(s);
    tray.setImage(companionIcon ?? trayImage());
    trayIconSource = companionIcon
      ? `${s.companion!.name} ${companionIcon.getSize().width}x${companionIcon.getSize().height}`
      : 'egg glyph';

    if (isMac && prefs.showTokensInTray) {
      // setTitle is macOS-only — this is how the number sits next to the icon.
      tray.setTitle(` ${tokens}`);
    } else if (isMac) {
      tray.setTitle('');
    }
    // Windows has no tray text at all, so the number lives in the tooltip.
    tray.setToolTip(`PokeTokenPet — ${label} ${pct}% · 오늘 ${tokens}`);
  } catch {
    tray.setToolTip('PokeTokenPet');
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '창 열기', click: () => togglePopover(true) },
    { type: 'separator' },
    {
      label: '데스크탑 펫',
      submenu: [
        {
          label: '표시',
          type: 'checkbox',
          checked: prefs.petEnabled,
          click: (i) => setPrefs({ petEnabled: i.checked }),
        },
        {
          label: '항상 위에',
          type: 'checkbox',
          checked: prefs.petAlwaysOnTop,
          click: (i) => setPrefs({ petAlwaysOnTop: i.checked }),
        },
        {
          label: '클릭 통과',
          type: 'checkbox',
          checked: prefs.petClickThrough,
          click: (i) => setPrefs({ petClickThrough: i.checked }),
        },
        { type: 'separator' },
        ...PET_SIZES.map((s) => ({
          label: `${s}px`,
          type: 'radio' as const,
          checked: prefs.petSize === s,
          click: () => setPrefs({ petSize: s }),
        })),
        { type: 'separator' },
        { label: '위치 초기화', click: () => setPrefs({ petX: null, petY: null }) },
      ],
    },
    {
      label: '메뉴바에 토큰 표시',
      type: 'checkbox',
      checked: prefs.showTokensInTray,
      visible: isMac,
      click: (i) => setPrefs({ showTokensInTray: i.checked }),
    },
    {
      label: '로그인 시 자동 실행',
      type: 'checkbox',
      checked: prefs.openAtLogin,
      click: (i) => setPrefs({ openAtLogin: i.checked }),
    },
    { type: 'separator' },
    { label: '데이터 폴더 열기', click: () => shell.openPath(appDataDir()) },
    { label: '지금 새로고침', click: () => void refreshAll(true) },
    { type: 'separator' },
    { label: '종료', role: 'quit' },
  ]);
}

// ---------------------------------------------------------------- windows

function rendererUrl(hash: string) {
  if (DEV_URL) return `${DEV_URL}#${hash}`;
  return `file://${path.join(__dirname_, '../dist/index.html')}#${hash}`;
}

/** Fit the panel to the display, leaving room for the menu bar and a margin. */
function popoverHeight() {
  const area = (tray ? screen.getDisplayMatching(tray.getBounds()) : screen.getPrimaryDisplay())
    .workArea;
  return Math.max(420, Math.min(760, area.height - 60));
}

function createPopover() {
  popover = new BrowserWindow({
    width: 420,
    height: popoverHeight(),
    show: false,
    frame: false,
    resizable: false,
    // A tray panel is anchored to the tray; letting it be dragged away leaves it
    // stranded somewhere the anchor logic will not bring it back from.
    movable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    vibrancy: isMac ? 'popover' : undefined,
    backgroundColor: isMac ? undefined : '#f6f5f1',
    webPreferences: { preload: path.join(__dirname_, 'preload.cjs') },
  });
  popover.loadURL(rendererUrl('popover'));
  popover.on('blur', () => popover?.hide());
  popover.on('closed', () => (popover = null));
}

/** Anchor to the tray, but clamp inside the display's work area. */
function positionPopover() {
  if (!popover || !tray) return;
  const t = tray.getBounds();
  const display = screen.getDisplayMatching(t);
  const area = display.workArea;
  const { width: w, height: h } = popover.getBounds();

  let x = Math.round(t.x + t.width / 2 - w / 2);
  let y = isMac ? Math.round(t.y + t.height + 4) : Math.round(t.y - h - 4);

  // Windows taskbars can sit on any edge, so never assume top or bottom.
  if (y + h > area.y + area.height) y = Math.round(t.y - h - 4);
  if (y < area.y) y = area.y + 4;
  x = Math.min(Math.max(x, area.x + 4), area.x + area.width - w - 4);
  popover.setPosition(x, y, false);
}

function togglePopover(forceShow = false) {
  if (!popover) createPopover();
  if (!popover) return;
  if (popover.isVisible() && !forceShow) {
    popover.hide();
    return;
  }
  // Track display changes, and always reopen at the top — reappearing halfway
  // down the panel reads as "it will not scroll back up".
  const h = popoverHeight();
  if (popover.getBounds().height !== h) popover.setBounds({ ...popover.getBounds(), height: h });
  popover.webContents
    .executeJavaScript('document.querySelector(".tabpanel")?.scrollTo(0,0)')
    .catch(() => {});
  positionPopover();
  popover.show();
  popover.focus();
}

function createPet() {
  // Created at the maximum any sprite can need, then tightened by pet:fitTo.
  // Starting small and growing would clip on any platform that refuses the
  // resize; starting large only leaves transparent, click-through margin.
  const size = MAX_PET_WINDOW;
  const area = screen.getPrimaryDisplay().workArea;
  const x = prefs.petX ?? area.x + area.width - size - 40;
  const y = prefs.petY ?? area.y + area.height - size - 60;

  pet = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(x),
    y: Math.round(y),
    show: false,
    frame: false,
    transparent: true,
    // Windows breaks transparency when the window is resizable, so size is
    // changed programmatically via setBounds instead of a drag handle.
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname_, 'preload.cjs') },
  });

  pet.loadURL(rendererUrl('pet'));
  pet.setAlwaysOnTop(prefs.petAlwaysOnTop, 'screen-saver');
  if (isMac) pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyClickThrough();
  pet.once('ready-to-show', () => prefs.petEnabled && pet?.show());
  pet.on('closed', () => (pet = null));
}

function applyClickThrough() {
  // forward:true is what lets the renderer still see mousemove, so it can ask
  // for the pointer back when the cursor is over an opaque pixel.
  pet?.setIgnoreMouseEvents(prefs.petClickThrough, { forward: true });
}

function applyPetPrefs() {
  if (!pet) {
    if (prefs.petEnabled) createPet();
    return;
  }
  if (!prefs.petEnabled) {
    pet.hide();
    return;
  }
  // Size is NOT set here. Sprites run from 38x38 to 178x95, so a square window
  // sized from prefs clipped most of them; the renderer measures its sprite and
  // calls fitTo instead. prefs.petSize is the requested zoom, not the window.
  if (prefs.petX == null || prefs.petY == null) {
    const area = screen.getPrimaryDisplay().workArea;
    const b0 = pet.getBounds();
    pet.setPosition(area.x + area.width - b0.width - 40, area.y + area.height - b0.height - 60);
  }
  pet.setAlwaysOnTop(prefs.petAlwaysOnTop, 'screen-saver');
  applyClickThrough();
  if (!pet.isVisible()) pet.show();
  pet.webContents.send('prefs', prefs);
}

async function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  if (patch.petSize != null) prefs.petSize = nearestSize(patch.petSize);
  await savePrefs(prefs);
  if ('openAtLogin' in patch) {
    app.setLoginItemSettings({
      openAtLogin: prefs.openAtLogin,
      openAsHidden: isMac,
      args: isMac ? [] : ['--hidden'],
    });
  }
  applyPetPrefs();
  tray?.setContextMenu(buildTrayMenu());
  popover?.webContents.send('prefs', prefs);
}

// ---------------------------------------------------------------- refresh

/**
 * One-shot startup summary.
 *
 * A tray app has no window to look at when something is wrong, so this is the
 * fastest way to see whether the tray, the pet and the data all came up.
 */
/**
 * Ask a window whether it actually painted anything.
 *
 * A file:// asset path mistake produces a perfectly healthy window containing a
 * blank page and no error at all, so "the window exists" proves nothing. This
 * checks the one thing that matters: did React mount into #root?
 */
async function renderCheck(win: BrowserWindow | null, label: string): Promise<string> {
  if (!win) return `${label}: absent`;
  try {
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => win.webContents.once('did-stop-loading', () => resolve()));
    }
    const n = await win.webContents.executeJavaScript(
      'document.getElementById("root")?.childElementCount ?? -1',
    );
    if (n === -1) return `${label}: no #root`;
    return n > 0 ? `${label}: ok` : `${label}: EMPTY (assets failed to load?)`;
  } catch (e) {
    return `${label}: ${String(e)}`;
  }
}

/**
 * Read the pet's ACTUAL rendered geometry out of the renderer.
 *
 * Counting #root children proves the window is not blank but says nothing about
 * clipping, which is a layout property. This asks the DOM directly: does the
 * sprite stage fit inside the window, and does the image still cover the stage
 * after the padding crop?
 */
async function petGeometry(): Promise<string> {
  if (!pet) return 'disabled';
  try {
    const g = await pet.webContents.executeJavaScript(`(() => {
      const st = document.querySelector('.pet-stage');
      const im = document.querySelector('.pet-sprite');
      if (!st || !im) return null;
      const s = st.getBoundingClientRect(), i = im.getBoundingClientRect();
      return {
        sw: Math.round(s.width), sh: Math.round(s.height),
        iw: Math.round(i.width), ih: Math.round(i.height),
        ix: Math.round(i.left - s.left), iy: Math.round(i.top - s.top),
        vw: window.innerWidth, vh: window.innerHeight,
      };
    })()`);
    if (!g) return 'not measured yet';
    const overflow = g.sw > g.vw || g.sh > g.vh;
    const gaps = g.ix > 0 || g.iy > 0 || g.ix + g.iw < g.sw || g.iy + g.ih < g.sh;
    const verdict = overflow ? 'CLIPPED by window' : gaps ? 'GAP in stage' : 'fits';
    return `${g.sw}x${g.sh} art in ${g.vw}x${g.vh} window · ${verdict}`;
  } catch (e) {
    return String(e);
  }
}

async function logStartup(s: PetState) {
  // Fetch through the custom scheme exactly as the renderer does. A packaged
  // app has no dev server, so this is the path that actually has to work.
  const spriteName = s.companion?.sprite ?? s.eggSprite;
  let spriteCheck = 'none';
  if (spriteName) {
    try {
      const res = await net.fetch(`petsprite://s/${encodeURIComponent(spriteName)}`);
      const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
      spriteCheck = res.ok ? `ok ${spriteName} (${bytes}B)` : `FAILED ${res.status}`;
    } catch (e) {
      spriteCheck = `FAILED ${String(e)}`;
    }
  }
  const renderChecks = [
    await renderCheck(popover, 'popover'),
    await renderCheck(pet, 'pet'),
  ];
  // Read AFTER the render checks: the renderer's fit lands during them, and a
  // bounds value captured earlier reports the pre-fit size, which is a lie.
  const b = pet?.getBounds();
  const lines = [
    `platform      ${process.platform} · electron ${process.versions.electron}`,
    `tray          ${tray ? 'ok' : 'FAILED'} · icon=${trayIconSource}${isMac ? ` · title="${prefs.showTokensInTray ? compact(s.tokens.today) : ''}"` : ' · tooltip only (Windows)'}`,
    `pet           ${pet ? `${b?.width}x${b?.height} @ ${b?.x},${b?.y} · visible=${pet.isVisible()} · onTop=${prefs.petAlwaysOnTop} · clickThrough=${prefs.petClickThrough}` : 'disabled'}`,
    `popover       ${popover ? 'created' : 'FAILED'}`,
    `render        ${renderChecks.join(' · ')}`,
    `pet art       ${await petGeometry()}`,
    `sprite fetch  ${spriteCheck}`,
    `companion     ${s.companion ? `${s.companion.name} ${s.companion.stageIndex + 1}/${s.companion.stageCount}` : '알'} · ${Math.round(s.progress.ratio * 100)}%`,
    `tokens today  ${s.tokens.today.toLocaleString()}`,
    `data dir      ${appDataDir()}`,
  ];
  console.log(`\n[poketokenpet]\n  ${lines.join('\n  ')}\n`);
}

async function refreshAll(force = false) {
  const s = await getState(force);
  await refreshTray();
  popover?.webContents.send('state', s);
  pet?.webContents.send('state', s);
  return s;
}

// ---------------------------------------------------------------- lifecycle

/**
 * Sprites live in ~/.poketokenpet/sprites, outside the bundle, so a packaged
 * app on file:// cannot reach them with a plain path. A custom scheme serves
 * them without standing up an HTTP server.
 * Must be declared before the app is ready.
 */
protocol.registerSchemesAsPrivileged([
  // corsEnabled plus an allow-origin header let the renderer fetch sprite bytes
  // and read them back off a canvas. Without it the canvas taints and
  // getImageData throws, which is how the pet measures its own art.
  {
    scheme: 'petsprite',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function registerSpriteProtocol() {
  protocol.handle('petsprite', async (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    const buf = await readSprite(name);
    if (!buf) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentTypeFor(name),
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  });
}

// Autostart plus a manual launch would otherwise give two pets racing on the
// same state file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => togglePopover(true));

  app.whenReady().then(async () => {
    prefs = await loadPrefs();
    registerSpriteProtocol();
    // No Dock icon: this is a menu-bar/tray app.
    if (isMac) app.dock?.hide();
    else app.setAppUserModelId('io.github.poketokenpet');

    tray = new Tray(trayImage());
    tray.setToolTip('PokeTokenPet');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => (isMac ? togglePopover() : togglePopover(true)));
    nativeTheme.on('updated', () => void refreshTray());

    createPopover();
    if (prefs.petEnabled) createPet();

    const s = await refreshAll(true);
    await logStartup(s);
    refreshTimer = setInterval(() => void refreshAll(), REFRESH_MS);
  });

  app.on('window-all-closed', () => {
    // A tray app outlives its windows.
  });

  app.on('before-quit', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  });
}

// ---------------------------------------------------------------- ipc

ipcMain.handle('pet:getState', (_e, force?: boolean) => getState(force === true));
ipcMain.handle('pet:shop', (_e, action: string, id: string, slot?: number | null) =>
  runShopAction(action, id, typeof slot === 'number' ? slot : null),
);
// Static and ~116KB, so it is fetched once rather than riding along on every
// pet:getState poll.
ipcMain.handle('pet:dexIndex', () => dexIndex());
// Per species and on demand, so it stays out of the 20s payload. Unlike
// dexIndex it reads the save, so it is never cached at this layer.
ipcMain.handle('pet:dexEntry', (_e, id: number, shiny?: boolean) =>
  dexEntry(Number(id), shiny === true),
);
ipcMain.handle('pet:getPrefs', () => prefs);
ipcMain.handle('pet:setPrefs', (_e, patch: Partial<Prefs>) => setPrefs(patch));
ipcMain.handle('pet:sizes', () => PET_SIZES);

ipcMain.handle('pet:stepSize', (_e, delta: number) => setPrefs({ petSize: stepSize(prefs.petSize, delta) }));

/**
 * Resize the pet window around its own centre to whatever the renderer measured.
 *
 * Clamped to the work area so an oversized sprite at a high zoom cannot produce
 * a window bigger than the screen, and nudged back on screen afterwards so the
 * pet cannot end up mostly off the edge after growing.
 */
ipcMain.on('pet:fitTo', (_e, w: number, h: number) => {
  if (!pet || !Number.isFinite(w) || !Number.isFinite(h)) return;
  const b = pet.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const width = Math.max(32, Math.min(Math.round(w), area.width));
  const height = Math.max(32, Math.min(Math.round(h), area.height));
  if (b.width === width && b.height === height) return;

  let x = Math.round(b.x + (b.width - width) / 2);
  let y = Math.round(b.y + (b.height - height) / 2);
  x = Math.max(area.x, Math.min(x, area.x + area.width - width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - height));

  pet.setBounds({ x, y, width, height });
  console.log(`  pet fit       ${b.width}x${b.height} -> ${width}x${height}`);
  prefs.petX = x;
  prefs.petY = y;
  void savePrefs(prefs);
});

ipcMain.handle('pet:openPopover', () => togglePopover(true));

/**
 * Manual drag.
 *
 * -webkit-app-region: drag interacts badly with transparent windows plus
 * setIgnoreMouseEvents on Windows, so the renderer reports deltas instead.
 */
ipcMain.on('pet:drag', (_e, dx: number, dy: number) => {
  if (!pet) return;
  const [x, y] = pet.getPosition();
  pet.setPosition(Math.round(x + dx), Math.round(y + dy), false);
});

ipcMain.on('pet:dragEnd', () => {
  if (!pet) return;
  const [x, y] = pet.getPosition();
  void setPrefs({ petX: x, petY: y });
});

/** Let the renderer take the pointer back while the cursor is over the sprite. */
ipcMain.on('pet:setInteractive', (_e, interactive: boolean) => {
  if (!pet || prefs.petClickThrough) return;
  pet.setIgnoreMouseEvents(!interactive, { forward: true });
});
