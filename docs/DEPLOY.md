# 網站部署說明（打包與上架）

給負責 gudubi.com 網站的人（或 Claude session）看的交接文件：如何把《命運之手：台灣》打包成靜態檔，放進網站的子資料夾。

> 遊戲的原始碼只在這個 repo（`D:\workspace\TheTaiwan`，GitHub `gudubi/fate-of-formosa`）修改。
> 網站那邊只放「打包產出」，不要直接改產出裡的檔案；要改內容請回到這個 repo 改完再重新打包。

## 一、基本資訊

| 項目 | 內容 |
|---|---|
| 類型 | 純靜態網頁（HTML／JS／CSS／圖片），沒有後端、沒有資料庫、不需要 API |
| 打包產出 | `dist/`，約 3 MB、35 個檔案 |
| 路徑 | 全部是相對路徑，可以放在任何子資料夾，例如 `gudubi.com/games/fate-of-formosa/` |
| 建議資料夾名稱 | `fate-of-formosa` |
| 遊戲名稱 | 命運之手：台灣（Fate of Formosa） |
| 一句話介紹 | 將這座小島交給你三十年，你會交出什麼答案？ |
| 列表用圖示 | 產出裡的 `assets/icon-512.png`（正方形）、`assets/icon-192.png` |
| 分享連結格式 | `https://gudubi.com/games/fate-of-formosa/?seed=XXXXXX`（6 碼種子碼，玩家在遊戲內按「複製連結」產生） |

## 二、打包

需要 Node.js 18 以上（開發時用 v23）。

```bash
cd D:\workspace\TheTaiwan
git pull
npm ci
```

### 方法 A：用發布腳本（建議）

一個指令完成「型別檢查 → 建置 → 清空目標資料夾 → 複製產出」：

```bash
npm run publish:site -- D:\workspace\gudubi\gudubi_home\public\games\fate-of-formosa
```

- 目標資料夾的實際位置請依網站 repo 的慣例決定；上面的路徑是網站其他遊戲目前的放法（`gudubi_home/public/games/<slug>/`）。
- 也可以先設環境變數 `FOF_SITE_DIR` 指向目標資料夾，之後只要執行 `npm run publish:site`。
- **安全機制**：腳本會先清空目標資料夾，所以只接受下列三種目標，否則拒絕執行：
  1. 不存在的資料夾
  2. 空資料夾
  3. 上一次就是這個腳本放的資料夾（裡面有 `.fate_of_formosa` 記號檔）
- 完成後，目標資料夾裡會有 `.fate_of_formosa` 記號檔，內容是打包時的 commit 與時間，可以用來確認網站上是哪一版。

### 方法 B：手動

```bash
npm run build
```

再把 `dist/` **裡面的所有檔案**（不是 `dist` 資料夾本身）複製到網站的目標資料夾。更新時請先清空目標資料夾，避免留下舊版的檔案。

### 產出內容

```
index.html              入口
manifest.webmanifest    PWA 安裝資訊
sw.js                   離線快取（Service Worker）
assets/index-*.js/css   主程式（檔名含雜湊，每次內容變了檔名就會變）
assets/01-*.js … 12-*.js  「歷史上的今天」各月份資料（用到才載入）
assets/endings/*.webp   結局圖
assets/events/*.webp    事件分類圖
assets/*.png            圖示
map/ids.png, height.png 地圖資料
audio/                  空資料夾（音效是即時合成的，沒有音檔）
```

## 三、主機需求

1. **HTTPS**：離線快取（Service Worker）只能在 HTTPS 下運作。沒有 HTTPS 遊戲仍可以玩，只是沒有離線快取與安裝功能。
2. **資料夾網址要有結尾斜線**：遊戲用相對路徑，必須以 `/games/fate-of-formosa/` 開啟。
   - 大部分靜態主機會自動把 `/games/fate-of-formosa` 轉址到加上斜線的網址（已用 Python http.server 驗證過，`?seed=` 參數會保留）。
   - 如果網站主機不會自動轉址，網站上的連結一律寫成有斜線的版本，或在主機設定轉址。
3. **不需要任何改寫規則**：遊戲只有一個頁面，種子碼用網址參數 `?seed=`，不需要 SPA 的 fallback 設定。
4. **MIME 類型**（一般主機預設就對）：`.js` 為 `text/javascript`，`.webp` 為 `image/webp`，`.webmanifest` 建議 `application/manifest+json`。
5. **瀏覽器需求**：地圖解碼用到 `DecompressionStream`，需要 Chrome／Edge 80+、Safari 16.4+、Firefox 113+。

### 快取建議（有辦法設定 HTTP 標頭時）

| 檔案 | 建議 |
|---|---|
| `index.html`、`sw.js`、`manifest.webmanifest` | `no-cache`（每次都向主機確認），確保玩家拿到新版 |
| `assets/index-*.js`、`assets/index-*.css`、`assets/01-*.js` 等含雜湊的檔案 | 可以長期快取（`max-age=31536000, immutable`） |
| `map/*.png`、`assets/**/*.webp`、`assets/*.png` | 短期快取即可（例如一天） |

沒辦法設定也沒關係：遊戲內的 Service Worker 對頁面採「網路優先」，玩家下次開啟就會拿到新版。

## 四、與網站其他內容的關係

- **Service Worker 只管遊戲自己的資料夾**（scope 是 `/games/fate-of-formosa/`），不會攔截或快取網站的其他頁面與其他遊戲。
- **瀏覽器儲存空間**：遊戲用 `localStorage`，鍵名都以 `tgh-` 開頭，不會和其他遊戲衝突：
  `tgh-save-v1`（存檔）、`tgh-records-v1`（最佳紀錄）、`tgh-endings-v1`（過往結局）、`tgh-eggs-v1`（彩蛋圖鑑）、`tgh-settings-v1`（設定）、`tgh-muted`（靜音）。
  網站的其他程式請不要清除這些鍵，否則玩家的存檔與紀錄會消失。
- 遊戲本身已經有作者資訊與官方網站、GitHub 連結（標題頁與選單最下方），網站上不需要另外加。

## 五、更新流程

遊戲有新版本時：

1. 在這個 repo `git pull`，確認是要上架的 commit。
2. `npm ci`（依賴有變時才需要，但每次執行也無妨）。
3. `npm run publish:site -- <網站的遊戲資料夾>`。
4. 依網站自己的流程部署。
5. 打開網站上的 `.fate_of_formosa` 記號檔，或比對 `git log -1`，確認版本一致。

## 六、上架後檢查清單

1. 開啟 `https://gudubi.com/games/fate-of-formosa`（**不帶**結尾斜線），應自動轉到帶斜線的網址並正常顯示標題頁。
2. 標題頁背景的台灣地圖出現，「降臨・開始新局」按鈕從「地圖生成中…」變成可按。
3. 開啟 `…/fate-of-formosa/?seed=ABCDEF`，種子碼欄位自動填入 `ABCDEF`。
4. 開始新局，開場年份跑動到「遊戲即將開始...」後進入遊戲，地圖可以拖曳縮放。
5. 瀏覽器開發者工具 Console 沒有紅色錯誤；Application → Service Workers 的 scope 是遊戲資料夾。
6. 用手機直式開啟一次，確認版面正常。

## 七、在本機模擬子資料夾部署

不想動到網站時，可以先打包到暫存資料夾測試：

```bash
npm run publish:site -- C:\temp\sitetest\games\fate-of-formosa
python -m http.server 18765 --directory C:\temp\sitetest
```

再用瀏覽器開啟 `http://localhost:18765/games/fate-of-formosa`。
（`localhost` 視為安全來源，Service Worker 在這裡也會運作。）

## 八、常見問題

| 狀況 | 原因與處理 |
|---|---|
| 畫面一片黑、樣式全跑掉 | 網址少了結尾斜線，相對路徑解析到上一層。改用帶斜線的網址或設定轉址。 |
| 一直停在「地圖生成中…」 | `map/ids.png`、`map/height.png` 沒有上傳或路徑錯；或瀏覽器太舊不支援 `DecompressionStream`。 |
| 更新後玩家還看到舊版 | `index.html` 被長期快取。設定 `no-cache`，或請玩家重新整理一次。 |
| `publish:site` 說「目標資料夾裡已經有別的東西」 | 目標資料夾有不是這個腳本放的檔案，腳本不敢清空。確認路徑正確，必要時手動清空再執行。 |
