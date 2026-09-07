/**
 * Bundles the Electron main and preload scripts with esbuild.
 *
 * electron-vite would do this too, but it peer-depends on Vite <= 7 while this
 * project is on Vite 8. esbuild is already present via Vite, needs no config
 * file, and keeps the toolchain to one fewer moving part.
 *
 *   main    -> ESM (.mjs)  — Electron 43 runs an ESM main fine
 *   preload -> CJS (.cjs)  — sandboxed preloads must be CommonJS
 */
import { build, context } from 'esbuild';
import { rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: dev,
  minify: !dev,
  // Electron is provided by the runtime and must never be bundled.
  external: ['electron'],
  logLevel: 'info',
};

const builds = [
  { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.mjs', format: 'esm' },
  { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs' },
];

await rm('dist-electron', { recursive: true, force: true });

if (watch) {
  for (const cfg of builds) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('electron: watching');
} else {
  await Promise.all(builds.map((cfg) => build(cfg)));
}
