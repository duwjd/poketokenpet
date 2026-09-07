/**
 * Dev runner: Vite dev server + Electron, wired together.
 *
 * Starts Vite, waits for it to report a URL, builds main/preload in watch mode,
 * then launches Electron pointed at the dev server so the renderer keeps HMR.
 */
import { spawn } from 'node:child_process';
import electron from 'electron';

const children = [];
let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const vite = spawn('npx', ['vite', '--strictPort'], { stdio: ['ignore', 'pipe', 'inherit'] });
children.push(vite);

const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Vite did not start within 60s')), 60_000);
  let buf = '';
  vite.stdout.on('data', (chunk) => {
    const text = String(chunk);
    process.stdout.write(text);
    buf += text;
    const m = buf.match(/https?:\/\/localhost:\d+/);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  });
  vite.on('exit', (c) => reject(new Error(`Vite exited with ${c}`)));
});

console.log(`\nelectron: dev server at ${url}`);

const esbuild = spawn('node', ['scripts/build-electron.mjs', '--watch'], { stdio: 'inherit' });
children.push(esbuild);

// Give the first watch build a moment to land before Electron reads main.mjs.
await new Promise((r) => setTimeout(r, 1500));

const app = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, ELECTRON_ENABLE_LOGGING: '1' },
});
children.push(app);
app.on('exit', (code) => stopAll(code ?? 0));
