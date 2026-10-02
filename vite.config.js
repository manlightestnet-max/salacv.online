import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  build: { target: 'es2022', outDir: '../dist', emptyOutDir: true },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  // En local, /api va au serveur Node (npm start, port 3000), comme sur Vercel.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
