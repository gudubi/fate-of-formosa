# 圖片素材提示詞（交給 Codex / 圖像模型生成）

標題畫面維持現有設計，不使用背景圖；App 圖示已完成（`public/assets/icon-*.png`）。

> 狀態：事件插圖 6 張與結局插圖 6 張已完成（2026-11-03），以下提示詞保留供日後重繪參考。

遊戲在**沒有這些圖片時也能完整運作**（會自動改用漸層背景）。生成後把檔案放到下表指定的路徑，重新整理頁面就會套用，不需要改程式。

## 共同風格（每張提示詞都已內含，也可統一附加）

> Cinematic digital painting, muted deep navy and teal palette with warm amber highlights, soft volumetric light, subtle film grain, calm and contemplative mood, high detail, no text, no letters, no logos, no watermark.

### 中立性規則（重要，請一併交代給 Codex）

- **不要出現任何國旗、黨旗、政黨標誌或政治人物**，也不要出現可辨識的真人臉孔。
- **避免以藍色對綠色作為對立色彩**（在台灣會被解讀為政黨顏色）。整體以深藍青色加琥珀色為主。
- 不要有文字、標語、浮水印。
- 戰爭相關畫面只用象徵手法（風暴、遠方光點、陰影），**不描繪武器、傷亡或暴力**。

---

## 1. 事件視窗頂部插圖（6 張）

**放置位置：** `public/assets/events/<類別>.webp`

**尺寸：** 1200×400

這些圖會顯示在事件視窗頂端約 120px 高的區塊。左上角會疊一層類別色光暈，下方會漸層淡入卡片背景，所以**主體請放在畫面上半部、偏右**。

| 檔名 | 類別 | 提示詞 |
|---|---|---|
| `disaster.webp` | 天災 | `Dramatic typhoon clouds and heavy rain sweeping over steep green mountains and a coastal town in Taiwan, distant landslide scars, orange emergency lights glowing in the rain, wide panoramic banner, subject in upper right, cinematic digital painting, muted navy palette with warm orange highlights, no text, no people faces` |
| `strait.webp` | 兩岸 | `Wide calm-but-tense seascape of a strait at twilight, silhouettes of distant grey ships on the horizon, a lone lighthouse on a small island, red warning light reflecting on dark water, panoramic banner, subject in upper right, cinematic digital painting, deep navy with red accent light, no flags, no text, no weapons firing` |
| `politics.webp` | 政治 | `Grand neoclassical government hall interior with tall columns, empty rows of seats under a large skylight, soft violet and amber light beams, sense of weight and decision, panoramic banner, subject in upper right, cinematic digital painting, no flags, no emblems, no text, no people faces` |
| `public.webp` | 民意 | `Large peaceful crowd of silhouetted people holding warm handheld lights on a wide city avenue at night, seen from above at a distance, golden yellow glow, no signs, no banners with text, panoramic banner, subject in upper right, cinematic digital painting, no flags, no recognizable faces` |
| `intl.webp` | 國際 | `Night view of a stylized globe with glowing cyan shipping and flight routes converging toward a small island in East Asia, abstract data lines, deep space navy background, panoramic banner, subject in upper right, cinematic digital painting, no country labels, no text, no flags` |
| `economy.webp` | 經濟社會 | `Modern semiconductor fab and dense city skyline of Taiwan at blue hour, cranes, a busy container port with warm amber lights, light trails of traffic, panoramic banner, subject in upper right, cinematic digital painting, muted navy with pale gold highlights, no text, no logos` |

---

## 2. 結局插圖（6 張）

**放置位置：** `public/assets/endings/<結局>.webp`

**尺寸：** 1600×700（約 16:7）

| 檔名 | 結局 | 提示詞 |
|---|---|---|
| `timeup.webp` | 撐過 30 年 | `Sunrise over the island of Taiwan seen from the sea, calm ocean, mist rising from green mountains, a gentle golden beam of light from the clouds resting on the island, hopeful and serene, cinematic wide shot, muted navy and teal palette with warm amber highlights, no text, no flags` |
| `indep.webp` | 宣告獨立 | `Symbolic scene: the island of Taiwan at dawn with a new bright light rising behind its mountains, the surrounding sea half in shadow and half in light, a sense of a historic turning point, uncertain but determined mood, cinematic wide shot, muted navy and amber palette, no flags, no text, no people, no symbols` |
| `unify.webp` | 宣告統一 | `Symbolic scene: a wide calm strait at dawn where two coastlines face each other, a long bridge of soft light forming across the water, a sense of a historic turning point, uncertain but solemn mood, cinematic wide shot, muted navy and amber palette, no flags, no text, no people, no symbols` |
| `war.webp` | 烽火 | `Symbolic, non-violent scene: a dark storm front gathering over a strait at night, distant flickering lights on the horizon, heavy clouds pressing down over an island silhouette, ominous and somber mood, no weapons, no explosions, no people, cinematic wide shot, deep navy with dim red glow, no text, no flags` |
| `collapse.webp` | 崩解 | `An empty city avenue in Taiwan at dusk after unrest, scattered papers blowing in the wind, dark storefronts, flickering streetlights, melancholic and quiet, no people, no violence, cinematic wide shot, muted grey-navy palette with weak amber light, no text, no signs` |
| `bankrupt.webp` | 枯竭 | `A quiet abandoned industrial port at dusk, idle cranes, rusting shipping containers, empty factory with broken windows, long shadows, sense of decline and stillness, cinematic wide shot, muted grey-navy palette with faded gold light, no text, no logos` |

---

## 3. 音效（選用，可不做）

音效預設由 Web Audio 即時合成，免下載、無授權問題。如果想換成真實音效，把 mp3 放進 `public/audio/` 會自動優先使用。

**檔名：** `click` `news` `start` `major` `resolve` `divine` `warn` `ending` `disaster` `strait` `politics` `public` `intl` `economy`

**建議的 CC0（免標示、可商用）來源：**

- Kenney Audio：<https://kenney.nl/assets?q=audio>
- Pixabay Sound Effects：<https://pixabay.com/sound-effects/>（使用 Pixabay 授權）
