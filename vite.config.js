import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  envDir: '..', // les variables VITE_* (Firebase) se mettent dans .env à la racine du dépôt
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
        admin: resolve(import.meta.dirname, 'app/admin/index.html'),
        desktop: resolve(import.meta.dirname, 'app/desktop.html'),
        auth: resolve(import.meta.dirname, 'app/auth/index.html'),
        welcome: resolve(import.meta.dirname, 'app/welcome/index.html'),
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  // En local, /api va au serveur Node (npm start, port 3000), comme sur Vercel.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
