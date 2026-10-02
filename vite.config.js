import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  build: { target: 'es2022', outDir: '../dist', emptyOutDir: true },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
