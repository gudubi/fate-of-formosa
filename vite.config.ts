import { defineConfig } from 'vite';

export default defineConfig({
  // 相對路徑：建置結果可直接放進任何子資料夾（gudubi.com/games/fate-of-formosa/）
  base: './',
  // 地圖資料與 three.js 合計約 1.4 MB（gzip 後約 430 KB），屬預期大小
  build: { chunkSizeWarningLimit: 2000 },
});
