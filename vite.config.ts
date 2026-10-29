import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA. Compute runs in a module Web Worker (format 'es'), so the worker can use
// ES module imports of src/core exactly like the main bundle and the tsx scripts.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
