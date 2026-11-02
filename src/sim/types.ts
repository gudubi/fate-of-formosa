// 模擬核心型別：事件資料（src/data/events/*.json）必須符合此結構

/** 國家層級數值。lean 類為 -100(宣告統一) … 0(維持現狀) … +100(宣告獨立)，其餘 0 … 100 */
export type StatKey =
  | 'govLean'   // 政府傾向
  | 'popLean'   // 民眾傾向（由各縣市人口加權）
  | 'intl'      // 國際看法：無所謂 0 … 100 重視
  | 'gdp'       // 國家經濟(GDP)：貧窮 0 … 100 富有
  | 'wealth'    // 人民財富（由各縣市人口加權）
  | 'stability' // 社會狀態：動亂 0 … 100 安穩（由各縣市人口加權）
  | 'tension'   // 兩岸緊張度：和緩 0 … 100 戰爭邊緣
  | 'trust'     // 政府信任度
  | 'defense'   // 國防實力
  | 'tech'      // 科技產業
  | 'demo';     // 人口活力（少子化／高齡化壓力，越低越嚴重）

/** 縣市層級數值（國家值為人口加權平均） */
export type CountyStatKey = 'popLean' | 'stability' | 'wealth';

/**
 * 可在條件與權重修正中讀取的衍生值：
 * gap = |govLean - popLean|（0…200）、absGov = |govLean|、absPop = |popLean|、
 * year = 遊戲年份（西元）、elapsed = 已經過年數（0…30）、
 * dep = 對單一市場的經濟依賴度（0…100，隱藏值；政府越偏向統一越高，與 tension 對稱）
 */
export type DerivedKey = 'gap' | 'absGov' | 'absPop' | 'year' | 'elapsed' | 'dep';
export type ReadKey = StatKey | DerivedKey;

export type Category = 'disaster' | 'strait' | 'politics' | 'public' | 'intl' | 'economy';
export type Tier = 'news' | 'general' | 'major';

/**
 * 權重修正：最終權重 *= exp(k * norm(stat))
 * norm：0…100 數值（含 dep）→ (v-50)/50（-1…1）；lean 類 → v/100（-1…1）；
 * gap/absGov/absPop → v/100（0…2 / 0…1）；elapsed → v/30（0…1）；year 不建議用於 mods
 * 例：{stat:'stability', k:-1.5} → 社會越動亂越容易發生
 */
export interface Mod { stat: ReadKey; k: number }

/** 觸發條件，全部成立才可能發生。例：['tension','>=',60] */
export type Cond = [ReadKey, '<' | '<=' | '>' | '>=', number];

/** 數值增減（國家層級）。popLean/stability/wealth 會套用到所有縣市 */
export type Effects = Partial<Record<StatKey, number>> & {
  /** govLean 往 popLean 靠近的比例（0…1） */
  govToPop?: number;
  /** popLean 往 govLean 靠近的比例（0…1） */
  popToGov?: number;
  /** 隱藏的經濟依賴度增減 */
  dep?: number;
};

export interface FollowUp {
  /** 後續事件 id（通常為 chainOnly 事件） */
  id: string;
  /** 幾個遊戲日後觸發 */
  delay: number;
  /** 觸發機率 0…1，預設 1 */
  chance?: number;
}

/**
 * 長期政策：在 days 天內把 stat 的「平衡點」移動 shift。
 * 一般 effects 會隨時間被拉回平衡點，policy 才能留下持久影響。
 * 適用 stat：gdp、trust、tension、intl、defense、tech、demo、stability、wealth
 */
export interface Policy { stat: StatKey; shift: number; days: number }

export interface OptionDef {
  /** 選項文字（建議 ≤ 14 字） */
  text: string;
  /** 結果簡述（建議 ≤ 30 字），結算後顯示 */
  result?: string;
  /** 不干預時的基礎權重 */
  weight: number;
  /** 權重修正：讓當下局勢影響「天意」 */
  mods?: Mod[];
  /** 立即效果 */
  effects?: Effects;
  /** 事件所在縣市額外效果（相鄰縣市承受 50%） */
  local?: Partial<Record<CountyStatKey, number>>;
  /** 持續效果：在 days 天內平均分攤 */
  over?: { days: number; effects: Effects };
  /** 長期政策（改變平衡點） */
  policy?: Policy[];
  /** 事件鏈 */
  follow?: FollowUp[];
  /** 干預此選項的命運花費；省略則依影響力與機率自動計算 */
  cost?: number;
  /** 觸發結局（僅引擎內建事件使用） */
  ending?: EndingId;
}

export interface EventDef {
  id: string;
  cat: Category;
  tier: Tier;
  /** 標題（建議 ≤ 14 字） */
  title: string;
  /** 描述，可用 {county} 代入發生地點名稱（建議 40–90 字） */
  desc: string;
  /** 在同層級中被抽中的相對權重（1 = 普通，0.3 = 罕見，3 = 常見） */
  rate: number;
  mods?: Mod[];
  cond?: Cond[];
  /** 再次發生前的冷卻天數 */
  cooldown?: number;
  /** 整局只發生一次 */
  once?: boolean;
  /** 只能由 follow 觸發，不會被隨機抽中 */
  chainOnly?: boolean;
  /**
   * 發生地點：縣市名稱陣列（隨機挑一個）、'random'（依人口加權的任一縣市），
   * 或命名海域／地點：'strait' 台灣海峽、'east' 台灣以東海域、'north' 東海、
   * 'south' 巴士海峽、'mainland' 對岸沿海、'pacific' 西太平洋、'world' 全區（國際事件）
   */
  loc: string[] | string;
  /** general / major 至少 2 個選項；news 可省略 options，改用 effects/local */
  options?: OptionDef[];
  /** news 用：立即效果 */
  effects?: Effects;
  /** news 用：發生地額外效果 */
  local?: Partial<Record<CountyStatKey, number>>;
  /** 同一事件的其他寫法，發生時隨機挑一個（避免重複出現同一句） */
  variants?: { title: string; desc?: string }[];
  /** 彩蛋事件（稀有、每局有上限、會記入彩蛋圖鑑） */
  egg?: EggInfo;
  /** 歷史參考（僅供設計者，不顯示） */
  ref?: string;
}

/** 彩蛋發生時的地圖特效 */
export type EggFx =
  | 'stars'      // 夜空星點閃爍
  | 'meteor'     // 火球劃過天際
  | 'snow'       // 山頭降雪
  | 'halo'       // 縣市上空光暈
  | 'whales'     // 海峽中游動的鯨群
  | 'footprints' // 一串腳印走進市區再走回去
  | 'mirage'     // 海峽上空倒懸的島嶼輪廓
  | 'pink'       // 湖面染成粉紅
  | 'heart'      // 颱風路徑畫成一顆心
  | 'beam'       // 地標射出光束
  | 'dream'      // 畫面暗下、柔光暈染
  | 'fade'       // 泡泡閃現後淡出
  | 'sparkle';   // 金色光點（預設）

/** 彩蛋發生時的音效 */
export type EggSfx = 'chime' | 'signal' | 'whale' | 'page' | 'pop' | 'wave' | 'crowd' | 'bell' | 'mystic';

export interface EggInfo {
  /** 稀有度 1–4 顆星（4 為傳說級） */
  stars: 1 | 2 | 3 | 4;
  /** 圖鑑中未解鎖時顯示的謎語提示 */
  hint: string;
  fx?: EggFx;
  sfx?: EggSfx;
  /** 這局曾經發生時，結局文字附加的一句 */
  epilogue?: string;
}

export type EndingId =
  | 'war' | 'unify' | 'indep' | 'collapse' | 'bankrupt'
  | 'timeup';
