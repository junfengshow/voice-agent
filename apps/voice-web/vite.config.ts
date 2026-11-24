// 主逻辑
// 配置前端开发服务的固定端口，将 HTTP 和 WebSocket 的 API 请求代理到 FastAPI。

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiHost = process.env.VOICE_HOST ?? '127.0.0.1';
const loopback = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost === '::' ? '::1' : apiHost;
const proxyHost = loopback.includes(':') ? `[${loopback}]` : loopback;

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: Number(process.env.VOICE_WEB_PORT ?? 8007),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${proxyHost}:${process.env.VOICE_PORT ?? '8008'}`,
        ws: true,
      },
    },
  },
});
