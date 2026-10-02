import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  build: { target: 'es2022', outDir: '../dist', emptyOutDir: true },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
