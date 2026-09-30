/**
 * The Electron half of `npm run gen:specimen`. Launched by scripts/gen-specimen.ts.
 *
 * Loads /specimen.html once per theme and captures the whole page at 1x — the
 * same pinned engine and the same 1x rule as scripts/shot-app.mjs, for the same
 * reason: a 2x capture resamples every bitmap glyph and frame into mush.
 * nativeTheme.themeSource is what drives prefers-color-scheme, so the dark shot
 * is the real dark stylesheet rather than an imitation of it.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeTheme } from 'electron';

const BASE = process.env.SPEC_BASE;
const OUT = process.env.SPEC_OUT;
if (!BASE || !OUT) throw new Error('specimen-app: SPEC_BASE / SPEC_OUT required');

const WIDTH = 420;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-lcd-text');
app.commandLine.appendSwitch('font-render-hinting', 'none');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(theme) {
  nativeTheme.themeSource = theme;
  const win = new BrowserWindow({ width: WIDTH, height: 800, show: false, useContentSize: true });
  // The first visit to a new entry makes Vite optimise its dependencies and
  // reload the page, which aborts the navigation in flight. Try again.
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadURL(`${BASE}/specimen.html`);
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      await sleep(1500);
    }
  }
  await sleep(500);
  // Galmuri is `font-display: block`: nothing is drawn until the faces land.
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await sleep(300);
  const height = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
  win.setContentSize(WIDTH, height);
  await sleep(300);
  const img = await win.webContents.capturePage();
  const { width: w } = img.getSize();
  if (w !== WIDTH) throw new Error(`specimen-app: captured ${w}px wide, not ${WIDTH} — not 1x`);
  const file = path.join(OUT, `ds-${theme}.png`);
  writeFileSync(file, img.toPNG());
  console.log(`→ ${path.relative(process.cwd(), file)}  ${w}x${img.getSize().height}`);
  win.destroy();
}

// Closing the light shot's window would otherwise quit before the dark one.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    await shoot('light');
    await shoot('dark');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
