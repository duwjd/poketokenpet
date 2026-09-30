/**
 * The Electron half of `npm run gen:readme`. Launched by scripts/gen-readme.ts.
 *
 * Loads /readme-art.html and captures each <section> by its own rect, at 1x —
 * the page is already drawn at twice the size the README shows it, so the
 * halving happens on GitHub, not here. See scripts/shot-app.mjs for why a 2x
 * capture would ruin the pixel art.
 *
 * The window is transparent so the download buttons come out with an alpha
 * channel and sit on GitHub's light and dark themes alike; the other sections
 * paint their own ground.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const BASE = process.env.ART_BASE;
const OUT = process.env.ART_OUT;
const VERSION = process.env.ART_VERSION ?? '';
if (!BASE || !OUT) throw new Error('readme-app: ART_BASE / ART_OUT required');

/** Section id -> file name in docs/img. */
const SHOTS = {
  hero: 'readme-hero',
  'dl-mac': 'readme-dl-mac',
  'dl-win': 'readme-dl-win',
  new: 'readme-new',
};

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-lcd-text');
app.commandLine.appendSwitch('font-render-hinting', 'none');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1800,
      height: 1000,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      useContentSize: true,
      // The what's-new card is taller than a laptop display; without this
      // macOS clamps the window to the screen and the capture comes back short.
      enableLargerThanScreen: true,
      webPreferences: { backgroundThrottling: false },
    });
    // Off every display, shown so it paints — same trick as shot-app.mjs.
    win.setPosition(-4000, -4000);
    win.showInactive();
    const url = `${BASE}/readme-art.html?v=${encodeURIComponent(VERSION)}`;
    // A new Vite entry optimises its deps on first visit and reloads; retry.
    for (let attempt = 1; ; attempt++) {
      try {
        await win.loadURL(url);
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await sleep(1500);
      }
    }
    const deadline = Date.now() + 20_000;
    while (!(await win.webContents.executeJavaScript('document.body?.dataset.ready === "1"'))) {
      if (Date.now() > deadline) throw new Error('readme-app: the page never became ready');
      await sleep(100);
    }
    for (const [id, name] of Object.entries(SHOTS)) {
      // One section on the page at a time, and the window sized to it: a
      // window taller than the display is clipped to it, so stacking all four
      // and cropping silently cut the lower ones short.
      const r = JSON.parse(
        await win.webContents.executeJavaScript(`(() => {
          for (const s of document.querySelectorAll('section')) s.style.display = s.id === ${JSON.stringify(id)} ? '' : 'none';
          return JSON.stringify(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect());
        })()`),
      );
      const rect = { x: 0, y: 0, width: Math.round(r.width), height: Math.round(r.height) };
      win.setContentSize(rect.width, rect.height);
      await sleep(600);
      const img = await win.webContents.capturePage(rect);
      const size = img.getSize();
      if (size.width !== rect.width || size.height !== rect.height) {
        throw new Error(
          `readme-app: ${name} captured ${size.width}x${size.height}, not ${rect.width}x${rect.height} ` +
            `— either not 1x or clamped to the display`,
        );
      }
      const file = path.join(OUT, `${name}.png`);
      writeFileSync(file, img.toPNG());
      console.log(`  ${name}.png  ${size.width}x${size.height}`);
    }
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
