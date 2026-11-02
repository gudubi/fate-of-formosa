import { defineConfig } from 'vite';

export default defineConfig({
  // 地圖資料與 three.js 合計約 1.4 MB（gzip 後約 430 KB），屬預期大小
  build: { chunkSizeWarningLimit: 2000 },
});
