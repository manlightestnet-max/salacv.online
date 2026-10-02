import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  build: {
    target: 'es2022',
    outDir: '../dist',
    emptyOutDir: true,
    // Trois pages : la landing (/), le studio (/studio/) et le tableau de bord (/dashboard/).
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'app/index.html'),
        studio: resolve(import.meta.dirname, 'app/studio/index.html'),
        dashboard: resolve(import.meta.dirname, 'app/dashboard/index.html'),
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  // En local, /api va au serveur Node (npm start, port 3000), comme sur Vercel.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
