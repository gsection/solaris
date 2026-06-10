import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  server: {
    proxy: {
      // dev-time proxy to the local production server for /api endpoints
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
