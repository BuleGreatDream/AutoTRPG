import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端源码在 web/，构建产物输出到项目根的 dist/。
// 注意：不能输出到 public/ —— src/stickers.js 要读 public/stickers/stickers.json，
// 会被 Vite 清空目录时删掉。dist/ 由 server.js 静态托管，/stickers 单独挂载。
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: '127.0.0.1', // 不指定时 Windows 上只监听 IPv6 的 ::1，127.0.0.1 会连不上
    // 开发时前端跑在 5173，后端仍是 3001：接口与表情包静态资源都转发过去
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/stickers': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
});
