import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { petApi } from './server/plugin.ts'

/**
 * The Content-Security-Policy the built page carries.
 *
 * Everything the panel loads is its own bundle (script, CSS, the Galmuri
 * font, the UI PNGs — some inlined as data: URIs) or a sprite through the
 * petsprite: scheme the main process serves from the local cache. Nothing is
 * fetched from the network by the page itself; the main process does that.
 * So the policy can be "own files and the cache, nothing else", and a string
 * that somehow reached the DOM as markup still could not run a script or
 * phone home.
 *
 * 'unsafe-inline' for styles only: React applies `style` through the CSSOM,
 * which CSP does not govern anyway, and a style is not a script.
 *
 * Build only. The dev server injects inline scripts (React Refresh, the HMR
 * client) that a strict policy would block, and `npm run dev`, gen:shots and
 * the Electron dev loop all run against it.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: petsprite:",
  "font-src 'self' data:",
  "connect-src 'self' petsprite:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'poketokenpet-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  }
}

// The token parser runs inside the dev server itself — one process, one command.
// A separate backend would be the first thing to rot in a hobby project.
export default defineConfig({
  // Relative asset paths. The packaged app loads index.html over file://, where
  // Vite's default absolute '/assets/...' resolves to the filesystem root and
  // silently loads nothing — a blank window with no error.
  base: './',
  plugins: [react(), petApi(), contentSecurityPolicy()],
})
