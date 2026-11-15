// QA dev server: same app, but no HMR and no file watching, so other edits in the repo don't reload pages mid-measurement.
// pnpm exec vite --config scripts/qa/vite.qa.config.mjs --port 5190   (then BASE=http://localhost:5190 node scripts/qa/…)
// QA_ROOT=<dir> serves another checkout (e.g. `git archive HEAD` for a «before» measurement).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: process.env.QA_ROOT ?? new URL('../..', import.meta.url).pathname,
  plugins: [react()],
  server: { hmr: false, watch: null },
});
