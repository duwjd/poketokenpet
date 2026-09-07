import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { petApi } from './server/plugin.ts'

// The token parser runs inside the dev server itself — one process, one command.
// A separate backend would be the first thing to rot in a hobby project.
export default defineConfig({
  // Relative asset paths. The packaged app loads index.html over file://, where
  // Vite's default absolute '/assets/...' resolves to the filesystem root and
  // silently loads nothing — a blank window with no error.
  base: './',
  plugins: [react(), petApi()],
})
