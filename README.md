# 上帝之手：台灣

作者：[gudubi.com](https://gudubi.com)（gudubi@gudubi.com）

以 Three.js 製作的網頁模擬遊戲。從**此刻的真實時間**開始，玩家以「上帝之手」介入事件，守護台灣走過 30 年。

## 執行

```bash
npm install
npm run dev        # 開發伺服器（--host，同網段的手機與平板可直接連線測試）
npm run build      # 輸出至 dist/，可部署到任何靜態網站主機
npm run simulate   # 無畫面批次模擬 300 局，檢查平衡
npm run check-history  # 檢查「歷史上的今天」資料格式與日期涵蓋
```

## 時間設計

| 項目 | 數值 |
|---|---|
| 一局長度 | 30 年（約 10,958 天） |
| 標準速度 | 4 天／秒，純時間約 45.7 分鐘，加上決策時間約 1 小時 |
| 2× 速度 | 8 天／秒 |
| 4× 速度 | 16 天／秒 |
| 開場 | 以真實時間流動 2.5 秒，再於 10 秒內加速到標準速度（×1 → ×345,600） |

### 每日事件機率

| 層級 | 每年平均 | 說明 |
|---|---|---|
| 快訊 | 26 次 | 只顯示在跑馬燈，小幅影響數值 |
| 一般事件 | 12 次 | 地圖冒出泡泡，30 天內可干預，逾期交給天意 |
| 重大事件 | 2.4 次 | 時間暫停，必須決定 |
| 固定排程 | — | 總統大選（每四年 1 月）、九合一（每四年 11 月） |

## 專案結構

```
src/
  sim/        純邏輯模擬（不依賴畫面，可在 Node 執行）
    engine.ts       數值連動、事件抽選、選舉、結局
    systemEvents.ts 選舉、海峽危機、宣告統一／獨立
    types.ts        事件資料格式（新增事件請看這裡）
  data/events/  事件資料 JSON（223 個）
  data/history/ 歷史上的今天（01–12.json，約 1,280 則，依月份延遲載入）
  map/          投影（1 單位 = 1 公里）、縣市柵格、地形
  render/       Three.js 場景
  ui/ audio/    介面設定、合成音效
tools/
  prepare-map.ts  重新產生地圖資料（npx tsx tools/prepare-map.ts）
  simulate.ts     平衡模擬
docs/ASSET_PROMPTS.md  圖片素材提示詞
```

## 新增或調整事件

在 `src/data/events/*.json` 加入符合 `src/sim/types.ts` 中 `EventDef` 的物件即可。完成後執行 `npm run simulate`，它會先檢查資料格式，再回報：

- 結局分布
- 各數值走向
- 從未發生的事件

## 資料來源

| 圖層 | 來源 | 授權 |
|---|---|---|
| 縣市界線 | 內政部國土測繪中心「直轄市、縣市界線（TWD97 經緯度）」，經 [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas) 簡化 | 政府資料開放授權條款；taiwan-atlas 為 MIT |
| 周邊國家 | Natural Earth，經 [world-atlas](https://github.com/topojson/world-atlas) 整理 | 公眾領域 |

「歷史上的今天」整理自維基百科日期與年份條目、政府網站及新聞資料，日期經交叉查核；無法確認日期的條目已排除。

地形是依主要山脈稜線（中央、雪山、玉山、阿里山、海岸山脈等）近似建模，並非真實 DEM。

## 授權

程式碼以 [MIT License](LICENSE) 釋出。地圖資料依各來源授權使用，詳見上方「資料來源」與 LICENSE。
