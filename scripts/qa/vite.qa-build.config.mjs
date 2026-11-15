// QA production build: React / three in production mode (real JS cost), but the app's dev hooks on
// (import.meta.env.DEV = true → ?dev=1 FPS probe, demo unlock, ?speed) and the game store exposed for the QA driver.
//   QA_ROOT=<checkout> pnpm exec vite build --config scripts/qa/vite.qa-build.config.mjs --outDir <dir>
//   pnpm exec vite preview --config scripts/qa/vite.qa-build.config.mjs --outDir <dir> --port 5196
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: process.env.QA_ROOT ?? new URL('../..', import.meta.url).pathname,
  plugins: [react(), {
    name: 'qa-expose-store',
    transform(code, id) {
      if (!id.endsWith('/src/store/game.ts')) return null;
      return `${code}\nimport * as __qaE from '../engine';\nif (typeof window !== 'undefined') Object.assign(window, { __qaGameExport: useGame, __qaEngineExport: __qaE });\n`;
    },
  }],
  define: { 'import.meta.env.DEV': 'true' },
  build: { minify: true, sourcemap: false },
});
