/**
 * Generator: the README's banner, download buttons and what's-new card,
 * docs/img/readme-*.png. Run with `npm run gen:readme [-- 0.4.0]`.
 *
 * Starts Vite on a port of its own and points the pinned Electron binary at
 * /readme-art.html (src/readme-art/, captured by scripts/readme-app.mjs). The
 * cards are crops of the gen:shots screenshots, so run that first when the
 * screens change. Pictures to look at, not a test to diff.
 *
 * The version printed on the banner is the argument, else package.json's —
 * pass the NEXT version when drawing them ahead of `npm version`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const PORT = 5197;
const OUT = path.resolve('docs/img');
mkdirSync(OUT, { recursive: true });
const VERSION = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;

const children: ReturnType<typeof spawn>[] = [];
const stopAll = () => {
  for (const c of children) if (!c.killed) c.kill();
};
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

console.log(`gen:readme — v${VERSION}, starting Vite on :${PORT}...`);
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
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
}).catch((err: Error) => {
  stopAll();
  console.error(`gen:readme — ${err.message}`);
  process.exit(1);
});

const code = await new Promise<number>((resolve) => {
  const proc = spawn(electron as unknown as string, ['scripts/readme-app.mjs', '--force-device-scale-factor=1'], {
    stdio: 'inherit',
    env: { ...process.env, ART_BASE: base, ART_OUT: OUT, ART_VERSION: VERSION },
  });
  children.push(proc);
  proc.on('exit', (c) => resolve(c ?? 1));
});

stopAll();
if (code !== 0) {
  console.error('gen:readme — the capture failed; see above.');
  process.exit(1);
}
console.log('gen:readme — done. Look at every picture before committing them.');
