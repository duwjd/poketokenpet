import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests need a DOM, the server/game/shop tests do not. Rather than
// running everything in happy-dom, each UI test file opts in with a
// `// @vitest-environment happy-dom` comment, so the logic suites stay in node.
export default defineConfig({
  plugins: [react()],
});
