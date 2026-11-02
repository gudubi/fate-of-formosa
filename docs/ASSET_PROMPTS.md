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

## 3. 彩蛋插圖（30 張，選用）

**放置位置：** `public/assets/eggs/<id>.webp`

**尺寸：** 1200×400（3:1）

用在彩蛋事件視窗頂端，以及彩蛋圖鑑解鎖後的卡片。沒有圖時會自動改用分類插圖。4 個後續事件沿用母事件的圖，不必另畫。

**構圖：** 主體放在畫面上半部、偏右。左上會疊分類色光暈，下方會漸層淡入卡片。

**彩蛋專屬風格（附加在共同風格之後）：**

> slightly magical and whimsical atmosphere, a touch of golden sparkle, storybook wonder, cinematic digital painting, muted deep navy and teal palette with warm amber highlights, no text, no letters, no logos, no flags, no recognizable real people

| 檔名 | 主題 | 提示詞 |
|---|---|---|
| `egg_alien_signal.webp` | 來自深空的規律訊號 | `A radio telescope dish on a misty Taiwanese mountain ridge at night, a faint rhythmic beam of light pulsing from the starry sky down to the dish, scientists' tiny silhouettes with flashlights, eerie and awe-inspiring, wide panoramic banner, subject in upper right` |
| `egg_dino_fossil.webp` | 工地挖出恐龍化石 | `A city metro construction site at dawn, an excavator paused beside a huge perfectly preserved dinosaur skeleton half-buried in the earth, paleontologists with brushes, warm work lights, sense of comic disbelief, wide panoramic banner, subject in upper right` |
| `egg_poem_novel.webp` | 《待曉詩篇》熱潮 | `A cozy independent bookstore in Taiwan glowing at dusk, long queue of readers outside, a stack of identical deep-blue hardcover novels with a dawn motif on the cover (no readable title), people reading on a metro train, warm literary mood, wide panoramic banner, subject in upper right` |
| `egg_satellite_asteroid.webp` | 國產衛星發現小行星 | `A small observation satellite orbiting above the glowing night-side of Taiwan, a tiny unknown asteroid catching sunlight in the distance, mission control room silhouettes cheering in an inset glow, wide panoramic banner, subject in upper right` |
| `egg_meteorite.webp` | 火球劃過夜空 | `A brilliant fireball meteor streaking across the night sky over Taiwanese rice paddies, lighting the farmland orange, a small smoking crater in a field, villagers with flashlights and magnets, wide panoramic banner, subject in upper right` |
| `egg_whales_strait.webp` | 鯨群現身台灣海峽 | `A pod of humpback whales surfacing in calm open sea at sunrise, whale spouts catching golden light, distant small grey patrol boats slowing down respectfully on both sides, fishermen photographing, peaceful and majestic, wide panoramic banner, subject in upper right, no flags` |
| `egg_clouded_leopard.webp` | 雲豹的影子 | `A misty old-growth mountain forest at night seen through a trail camera, a blurred spotted big-cat silhouette disappearing between giant trees, grainy infrared look, mysterious and bittersweet, wide panoramic banner, subject in upper right` |
| `egg_bear_downtown.webp` | 黑熊逛進市區 | `A Formosan black bear with the white V mark on its chest calmly napping on a park bench in a small Taiwanese town at dawn, convenience store lights glowing behind, police tape and amused onlookers at a distance, gentle humor, wide panoramic banner, subject in upper right` |
| `egg_mazu_halo.webp` | 遶境日的天空異象 | `A traditional temple procession with lanterns and incense smoke at night in rural Taiwan, a rare circular halo ring of light appearing in the clearing sky above, crowds looking up, respectful and wondrous, no depiction of deity faces, wide panoramic banner, subject in upper right` |
| `egg_street_food_world.webp` | 夜市小吃征服世界 | `A humble Taiwanese night market food stall with steam and warm lights, an enormous line of people from many countries winding around three streets, phones filming, a tired cheerful vendor checking flour bags, wide panoramic banner, subject in upper right, no brand names` |
| `egg_smalltown_baseball.webp` | 小鎮球隊的奇蹟之旅 | `A small seaside town baseball field at night with newly installed floodlights, an amateur team of fishermen and teachers celebrating on the mound, villagers cheering from the fence, confetti, underdog joy, wide panoramic banner, subject in upper right` |
| `egg_ai_milestone.webp` | 本土 AI 解開百年難題 | `A quiet research lab at night, glowing screens filled with elegant abstract mathematical patterns forming a solved puzzle, a soft beam of light rising from the server racks, researchers in awe, wide panoramic banner, subject in upper right, no readable text` |
| `egg_time_capsule.webp` | 二十年前的時空膠囊 | `An elementary school sports field under renovation, a rusty time capsule box opened on the grass revealing children's letters and crayon drawings of flying cars, grown-ups in their thirties gathered around smiling and tearful, nostalgic warm light, wide panoramic banner, subject in upper right` |
| `egg_yushan_snow.webp` | 玉山連下七天雪 | `Jade Mountain peaks in Taiwan heavily covered in deep fresh snow under a clear blue morning sky, a mountain village dusted with snow, a long line of car headlights winding up the mountain road, rare and joyful, wide panoramic banner, subject in upper right` |
| `egg_zero_blackout.webp` | 全年零大停電紀錄 | `Night view of Taiwan's cities fully illuminated without a single dark patch, power grid lines glowing like golden veins across the island, a tired engineer silhouette in a control room raising a coffee cup, wide panoramic banner, subject in upper right` |
| `egg_time_traveler.webp` | 自稱來自 2077 的旅人 | `A small Taiwanese police station at night, a polite stranger in subtly futuristic breathing fabric clothing sitting on a bench charging a strange glowing device from a wall socket, officers puzzled, soft surreal mood, wide panoramic banner, subject in upper right, no recognizable real people` |
| `egg_101_message.webp` | 101 自己亮起一行字 | `A tall bamboo-shaped skyscraper in a city skyline at 3 a.m., its facade lights forming an abstract glowing pattern of light that hints at a message (no readable letters), people on rooftops photographing, eerie and beautiful, wide panoramic banner, subject in upper right` |
| `egg_walking_tree.webp` | 會走路的神木 | `An ancient giant cypress tree in a misty Taiwanese mountain forest, its massive roots subtly shaped like slowly striding legs, faint footprint-like trails in the moss behind it, foresters with measuring tape, whimsical and mythic, wide panoramic banner, subject in upper right` |
| `egg_mirage_taiwan.webp` | 海峽上空的另一座島 | `Early morning over a calm sea, a giant pale translucent mirage of an island hanging upside down beneath the clouds with faint city lights, small fishing boats below looking up, eerie and dreamlike, wide panoramic banner, subject in upper right, no flags, no maps or labels` |
| `egg_ai_mazu.webp` | 解籤 App 準得離譜 | `A warm traditional Taiwanese temple interior with red wooden divination blocks on the floor, a smartphone glowing with a soft fortune-telling interface (no readable text), an elderly temple keeper smiling knowingly in the background, playful mood, wide panoramic banner, subject in upper right` |
| `egg_underground_city.webp` | 盆地底下的街道 | `A metro tunnel boring machine breaking into a vast underground cavern revealing an ancient stone-paved street, drainage channels and a wall carved with unknown symbols, workers' headlamps cutting through dust, mysterious and ancient, wide panoramic banner, subject in upper right` |
| `egg_ghost_month_off.webp` | 鬼月，祂們放假了 | `A peaceful Taiwanese night during ghost month, rows of offering tables with fruit and lanterns along a quiet street, a ghost-hunting livestreamer looking bored, soft friendly lantern glow, gentle humor rather than horror, wide panoramic banner, subject in upper right` |
| `egg_boba_heritage.webp` | 珍奶列入世界遺產 | `Two old bubble tea shops facing each other across a narrow Taiwanese street, each hanging a big red banner (no readable text), a bemused official delegate standing in the middle holding one cup from each, tapioca pearls and steam, festive humor, wide panoramic banner, subject in upper right, no brand names` |
| `egg_leopardcat_chief.webp` | 石虎當選網路里長 | `A Formosan leopard cat proudly patrolling a rice field ridge at dusk like a village chief, captured by a trail camera, tiny honorary sash on a fence post nearby, villagers smiling in the distance, wholesome humor, wide panoramic banner, subject in upper right` |
| `egg_magpie_medal.webp` | 藍鵲叼走了金牌 | `A Taiwan blue magpie with long blue tail flying away from an outdoor award ceremony carrying a shiny gold medal in its beak, its nest in a nearby tree glittering with spoons and a ring, athletes and officials laughing, wide panoramic banner, subject in upper right` |
| `egg_typhoon_uturn.webp` | 颱風迴轉又迴轉 | `A satellite-style view of a typhoon swirl off the coast of Taiwan whose track line loops into a perfect heart shape, a weather presenter silhouette shrugging in a studio inset, playful and surprising, wide panoramic banner, subject in upper right, no readable text` |
| `egg_sunmoon_pink.webp` | 日月潭變成粉紅色 | `A tranquil mountain lake in central Taiwan at sunrise with the entire water surface turned soft strawberry-milk pink, mist over green hills, a lone photographer on the pier, dreamy and delightful, wide panoramic banner, subject in upper right` |
| `egg_puppet_viral.webp` | 布袋戲甩袖紅遍全球 | `A Taiwanese glove puppet in ornate costume mid sleeve-flick on a small backstage, the elderly puppeteer's hand visible, behind it a glowing collage of people around the world copying the same pose, joyful viral energy, wide panoramic banner, subject in upper right, no recognizable real people` |
| `egg_same_dream.webp` | 全島同一個夢 | `A dreamlike quiet sea at twilight beside a tiny nameless train station platform, a distant figure on the platform waving, soft violet and gold haze, surreal and tender, wide panoramic banner, subject in upper right, no readable signs` |
| `egg_bottle_1949.webp` | 一九四九年的瓶中信 | `A child crouching on a quiet Taiwanese beach at golden hour holding an old barnacle-covered glass bottle with a faded rolled letter inside, gentle waves, bittersweet and hopeful, wide panoramic banner, subject in upper right, no readable text, no flags` |

---

## 4. 音效（選用，可不做）

音效預設由 Web Audio 即時合成，免下載、無授權問題。如果想換成真實音效，把 mp3 放進 `public/audio/` 會自動優先使用。

**檔名：** `click` `news` `start` `major` `resolve` `divine` `warn` `ending` `tick` `intervene` `disaster` `strait` `politics` `public` `intl` `economy`；彩蛋：`egg_chime` `egg_signal` `egg_whale` `egg_page` `egg_pop` `egg_wave` `egg_crowd` `egg_bell` `egg_mystic`

**建議的 CC0（免標示、可商用）來源：**

- Kenney Audio：<https://kenney.nl/assets?q=audio>
- Pixabay Sound Effects：<https://pixabay.com/sound-effects/>（使用 Pixabay 授權）
