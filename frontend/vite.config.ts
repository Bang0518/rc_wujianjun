import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发期把 API 请求代理到后端 :8080，避免 CORS；生产期由后端同源托管。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/notifications': 'http://localhost:8080',
      '/stats': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
});
