/**
 * Generator: the design-system specimen pictures, docs/img/ds-light.png and
 * docs/img/ds-dark.png. Run with `npm run gen:specimen`.
 *
 * Starts Vite on a port of its own and points the pinned Electron binary at
 * /specimen.html (scripts/specimen-app.mjs), once per theme. Like gen:shots,
 * these are pictures to look at, not a test to diff.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const PORT = 5198;
const OUT = path.resolve('docs/img');
mkdirSync(OUT, { recursive: true });

const children: ReturnType<typeof spawn>[] = [];
const stopAll = () => {
  for (const c of children) if (!c.killed) c.kill();
};
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

console.log(`gen:specimen — starting Vite on :${PORT}...`);
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
  console.error(`gen:specimen — ${err.message}`);
  process.exit(1);
});

const code = await new Promise<number>((resolve) => {
  const proc = spawn(electron as unknown as string, ['scripts/specimen-app.mjs', '--force-device-scale-factor=1'], {
    stdio: 'inherit',
    env: { ...process.env, SPEC_BASE: base, SPEC_OUT: OUT },
  });
  children.push(proc);
  proc.on('exit', (c) => resolve(c ?? 1));
});

stopAll();
if (code !== 0) {
  console.error('gen:specimen — the capture failed; see above.');
  process.exit(1);
}
console.log('gen:specimen — done. Look at both pictures before committing them.');
