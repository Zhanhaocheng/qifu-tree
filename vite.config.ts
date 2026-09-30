import { defineConfig } from 'vite';

const WEB_PORT = Number(process.env.WEB_PORT ?? 47231);
const API_PORT = Number(process.env.PORT ?? 47232);

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: WEB_PORT,
    strictPort: true,
    allowedHosts: true,
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
  preview: { host: '0.0.0.0', port: WEB_PORT, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1200 },
});
