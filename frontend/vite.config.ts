import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rawBackendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const proxyTarget = /^https?:\/\//.test(rawBackendUrl)
  ? rawBackendUrl
  : `http://${rawBackendUrl}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
