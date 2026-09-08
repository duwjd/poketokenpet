/**
 * Generator: the README screenshots in docs/img/.
 *
 * Run with `npm run gen:shots`. Starts a Vite dev server on a port of its own,
 * launches the pinned Electron binary pointed at it with the demo payloads from
 * scripts/shotdata.ts stubbed in, and writes seven PNGs.
 *
 * ## These are artifacts, not tests
 *
 * Do NOT add a CI job that regenerates and diffs docs/img/. It would fail every
 * single run: nearly every sprite is an animated GIF (390 of the 609 in a warm
 * cache), and which frame is on screen at capture time is not knowable. The
 * pictures are regenerated on purpose, looked at by a person, and committed.
 *
 * ## What IS pinned
 *
 * Everything that would otherwise change the picture between machines:
 * the theme (nativeTheme.themeSource = 'light'), the clock and timezone (the
 * scene's colour grade is a function of the hour), reduced motion, the device
 * scale factor, and the species list. See scripts/shotdata.ts and
 * scripts/shot-preload.cjs for the why of each.
 *
 * ## What is not, and cannot be
 *
 * - Emoji glyphs come from the OS font (src/App.css:227 falls through for what
 *   Galmuri does not cover), so the shiny ✨ differs on Windows.
 * - The CSS half of prefers-reduced-motion cannot be overridden from JS. If the
 *   machine has Reduce Motion on, entrance animations stay dead; we warn.
 * - A cold sprite cache needs network. ensureSprite throws with the id rather
 *   than emitting a card with a hole in it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';
import { buildPayloads } from './shotdata.ts';

/** Its own port, so it never fights a contributor's `npm run dev` on 5173. */
const PORT = 5199;
const OUT = path.resolve('docs/img');

function fail(msg: string): never {
  console.error(`\ngen:shots — ${msg}\n`);
  process.exit(1);
}

const children: ReturnType<typeof spawn>[] = [];
function stopAll() {
  for (const c of children) if (!c.killed) c.kill();
}
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

console.log('gen:shots — building demo payloads (may download sprites)...');
const payloads = await buildPayloads().catch((err) => fail(err.message));
console.log(`  dex grid: ${payloads.dexIds.length}종 — ${payloads.dexIds.join(', ')}`);

const dataFile = path.join(os.tmpdir(), `poketokenpet-shots-${process.pid}.json`);
writeFileSync(dataFile, JSON.stringify(payloads));
mkdirSync(OUT, { recursive: true });

console.log(`gen:shots — starting Vite on :${PORT}...`);
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
children.push(vite);

const base = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Vite did not start within 60s')), 60_000);
  let buf = '';
  vite.stdout!.on('data', (chunk) => {
    buf += String(chunk);
    const m = buf.match(/https?:\/\/localhost:\d+/);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  });
  vite.on('exit', (c) => reject(new Error(`Vite exited with ${c} — is :${PORT} already taken?`)));
}).catch((err) => {
  stopAll();
  return fail(err.message);
});

console.log(`gen:shots — capturing from ${base}\n`);
const code = await new Promise<number>((resolve) => {
  const proc = spawn(
    electron as unknown as string,
    /*
     * The scale factor has to be on the command line, not just
     * app.commandLine.appendSwitch inside the app: on a Retina display
     * Chromium has already picked the backing scale by the time module
     * code runs, and capturePage comes back at 2x. shot-app.mjs asserts
     * the captured size, so a regression here fails loudly.
     */
    ['scripts/shot-app.mjs', '--force-device-scale-factor=1'],
    {
    stdio: 'inherit',
    env: {
      ...process.env,
      SHOT_BASE: base,
      SHOT_DATA: dataFile,
      SHOT_OUT: OUT,
      // The scene's colour grade and two toLocale* calls are timezone-sensitive;
      // the preload pins the instant, this pins the zone it is read in.
      TZ: 'Asia/Seoul',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    },
  );
  children.push(proc);
  proc.on('exit', (c) => resolve(c ?? 1));
});

stopAll();
if (code !== 0) fail('the capture run failed; see the error above. Nothing was committed.');
console.log(`\ngen:shots — done. Look at the PNGs in ${OUT} before committing them.`);
