import type {
  Category, CountyStatKey, Effects, EndingId, EventDef, OptionDef, ReadKey, StatKey, Tier,
} from './types';
import { Rng } from './rng';
import { COUNTY_BASE, NAMED_POINTS, SEA_LINKS } from './countyData';
import { SYSTEM_EVENTS } from './systemEvents';

export const DAY_MS = 86_400_000;
/** 遊戲一律使用台北時間（UTC+8）計算日期 */
export const TW_OFFSET = 8 * 3_600_000;
export const YEARS = 10;
export const DIVINE_MAX = 25;
export const DIVINE_EVERY = 30; // 每 N 天 +1 命運

/** 各層級每年平均事件數 */
const TIER_RATE: Record<Tier, number> = { news: 22, general: 12, major: 2.4 };
/** 重大事件配速：剩餘件數 × 此倍率 ÷ 剩餘年數，下限 MAJOR_RATE_MIN 次／年 */
const MAJOR_PACE = 0.85;
const MAJOR_RATE_MIN = 0.8;
const DEFAULT_COOLDOWN: Record<Tier, number> = { news: 365, general: 365, major: 900 };
/** 一般事件不倒數；同時待決超過此數時，最舊的一件交給自然命運 */
export const MAX_PENDING = 5;
/** 每局最多出現幾個彩蛋（不含彩蛋的後續事件），讓稀有事件保持稀有 */
export const EGG_CAP = 3;
/** 彩蛋每年平均發生次數（不和一般事件搶同一個抽籤池，稀有度才穩定） */
const EGG_RATE = 0.13;
/** 每五年一次回顧（一局十年，第 5 年回顧一次） */
export const REVIEW_DAYS = 1826;
/** 事件選項的影響倍率：讓每個選擇的後果更明顯（快訊不受影響） */
export const OPTION_IMPACT = 1.5;
/** 長期政策移動平衡點的倍率 */
export const POLICY_IMPACT = 0.75;
/**
 * 主動出手留下的痕跡：選項立即效果的 shift 比例轉成平衡點偏移，數值不會很快被拉回原處。
 * days 為持續天數（最後 fade 天逐漸淡出），null 表示永久。順其自然的結果沒有這個效果。
 */
export const HAND = { shift: 0.6, days: 1826 as number | null, fade: 730 };
/** 會留下出手痕跡的數值：只限治理類，統獨傾向與兩岸緊張不受影響以維持中立 */
const HAND_STATS: StatKey[] = ['intl', 'gdp', 'wealth', 'stability', 'trust', 'defense', 'tech', 'demo'];
/** 快訊對數值的影響倍率：快訊是背景雜訊，壓低後玩家的選擇比較不會被淹沒 */
const NEWS_IMPACT = 0.5;
/** 「永久」偏移的到期日（存檔是 JSON，不能用 Infinity） */
const FOREVER = 1e9;

/** 快訊效果一律等比縮小（含經濟依賴，兩端對稱） */
function scaleNews(e: Effects): Effects {
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, (v as number) * NEWS_IMPACT])) as Effects;
}

/** 依倍率放大效果；「向對方靠攏」是比例，放大後上限 0.95 */
export function scaleEffects(e: Effects, f = OPTION_IMPACT): Effects {
  const out: Effects = {};
  for (const [k, v] of Object.entries(e)) {
    // 依賴度是緩慢累積的結構因子，不隨選項倍率放大
    (out as any)[k] = k === 'dep' ? v : k === 'govToPop' || k === 'popToGov' ? Math.min(0.95, (v as number) * f) : (v as number) * f;
  }
  return out;
}
const POLICY_STATS: StatKey[] = ['gdp', 'trust', 'tension', 'intl', 'defense', 'tech', 'demo', 'stability', 'wealth'];

export const STAT_ORDER: StatKey[] = [
  'govLean', 'popLean', 'intl', 'gdp', 'wealth', 'stability', 'tension', 'trust', 'defense', 'tech', 'demo',
];
const LEAN: StatKey[] = ['govLean', 'popLean'];
const COUNTY_KEYS: CountyStatKey[] = ['popLean', 'stability', 'wealth'];

export interface County {
  name: string;
  pop: number;
  wealthOffset: number;
  links: number[];
  popLean: number;
  stability: number;
  wealth: number;
}

export interface Pending {
  uid: number;
  eventId: string;
  tier: Tier;
  county: number | null;
  point: string | null;
  createdDay: number;
  expiresDay: number;
}

export interface LogEntry {
  day: number;
  eventId: string;
  title: string;
  cat: Category;
  tier: Tier;
  place: string;
  county: number | null;
  point: string | null;
  option: number;
  optionText?: string;
  /** 新聞實際顯示的內文（可能是變體） */
  desc?: string;
  intervened: boolean;
  result?: string;
  deltas?: Partial<Record<StatKey, number>>;
}

export interface Ending {
  id: EndingId;
  day: number;
  title: string;
  text: string;
  score: number;
  survived: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  /** 種子碼（分享給其他玩家用） */
  code?: string;
  /** 世界亂數：事件何時發生、發生什麼、背景因子 */
  rng: number;
  /** 自然命運亂數：順其自然的結果、事件鏈機率。與世界亂數分開，玩家的選擇不會打亂事件節奏 */
  fateRng: number;
  /** 開局時刻（台北時間 ms） */
  startTw: number;
  /** 開局當天 00:00（台北時間 ms） */
  startDayTw: number;
  day: number;
  endDay: number;
  stats: Record<StatKey, number>;
  counties: County[];
  /** 隱藏因子：全球景氣、對岸態度、世代認同、社會氛圍（-1…1）；經濟依賴度 dep（0…100） */
  hidden: { econ: number; stance: number; identity: number; mood: number; dep: number };
  /** 生效中的長期政策（移動平衡點） */
  /** hand：玩家出手留下的偏移（from 為開始日，最後 HAND.fade 天淡出；永久者 until 為很大的數） */
  policies: { stat: StatKey; shift: number; until: number; hand?: boolean; from?: number }[];
  /** 目前生效的連鎖反應狀態 id */
  chains: string[];
  divine: number;
  /** 累計干預次數 */
  interventions: number;
  /** 已達成的里程碑與其連續天數計數 */
  achieved: string[];
  streak: Record<string, number>;
  /** 已完成的五年回顧次數 */
  reviews: number;
  /** 本局遇到的彩蛋事件 id（依發生順序，含後續事件） */
  eggs: string[];
  cooldown: Record<string, number>;
  once: string[];
  ongoing: { perDay: Effects; days: number }[];
  scheduled: { day: number; id: string }[];
  pending: Pending[];
  history: { day: number; s: number[] }[];
  log: LogEntry[];
  uid: number;
  lowStab: number;
  lowEcon: number;
  ended: Ending | null;
}

export interface EngineHooks {
  news(e: LogEntry): void;
  pending(p: Pending): void;
  major(p: Pending): void;
  resolved(e: LogEntry, p: Pending): void;
  ended(e: Ending): void;
  divine(n: number): void;
  achieved(m: Milestone): void;
  /** 連鎖反應狀態進入（on）或解除 */
  chain(c: ChainState, on: boolean): void;
}

export interface ChainState { id: string; title: string; good: boolean; enter: string; exit: string }

/**
 * 連鎖反應：數值跨過門檻時進入的狀態，只負責讓玩家知道，效果本身寫在 dynamics 的數值連動裡。
 * 進入與解除用不同門檻，避免在門檻附近來回跳動。
 */
const CHAINS: (ChainState & { on: (st: Record<StatKey, number>) => boolean; off: (st: Record<StatKey, number>) => boolean })[] = [
  { id: 'distrust', title: '信任危機', good: false, enter: '民眾對政府失去耐心，政策方向開始引發民意反彈，施政效果打折。', exit: '民眾對政府的信任慢慢回來了。',
    on: st => st.trust < 38, off: st => st.trust >= 46 },
  { id: 'unity', title: '民心凝聚', good: true, enter: '民眾信任政府，政策更容易推動，出手的效果加成。', exit: '民眾的信任開始鬆動，施政加成消失。',
    on: st => st.trust >= 66, off: st => st.trust < 60 },
  { id: 'unrest', title: '動盪螺旋', good: false, enter: '社會失序開始拖累經濟與政府信任，不處理會越陷越深。', exit: '社會秩序逐漸恢復，動盪不再擴散。',
    on: st => st.stability < 35, off: st => st.stability >= 40 },
  { id: 'drain', title: '人才外流', good: false, enter: '經濟低迷，年輕人與工程師開始出走，人口與科技受到拖累。', exit: '經濟回穩，人才外流趨緩。',
    on: st => st.gdp < 40, off: st => st.gdp >= 48 },
  { id: 'spotlight', title: '國際焦點', good: true, enter: '國際關注帶來合作與投資，科技產業跟著受惠。', exit: '國際的目光漸漸移開，投資熱潮退去。',
    on: st => st.intl >= 85, off: st => st.intl < 80 },
];
export const CHAIN_LIST: ChainState[] = CHAINS.map(({ id, title, good, enter, exit }) => ({ id, title, good, enter, exit }));

export interface Milestone { id: string; title: string; desc: string }

/** 里程碑：check 回傳 true 的連續天數達 days 即達成 */
const MILESTONES: (Milestone & { days: number; check: (e: Engine) => boolean })[] = [
  { id: 'term', title: '撐過第一個任期', desc: '島嶼走過 4 年', days: 1, check: e => e.s.day >= 1461 },
  { id: 'decade', title: '走完十年', desc: '島嶼平安走完這十年', days: 1, check: e => e.s.day >= e.s.endDay },
  { id: 'calm', title: '風平浪靜', desc: '兩岸緊張度連續 2 年不高於 30', days: 730, check: e => e.s.stats.tension <= 30 },
  { id: 'settled', title: '安居樂業', desc: '社會狀態連續 3 年不低於 65', days: 1096, check: e => e.s.stats.stability >= 65 },
  { id: 'rich', title: '藏富於民', desc: '人民財富達到 72', days: 1, check: e => e.s.stats.wealth >= 72 },
  { id: 'shield', title: '矽之盾', desc: '科技產業 90 以上且國際看法 80 以上', days: 1, check: e => e.s.stats.tech >= 90 && e.s.stats.intl >= 80 },
  { id: 'youth', title: '人口回春', desc: '第 5 年後人口活力回到 50', days: 1, check: e => e.s.day > 1826 && e.s.stats.demo >= 50 },
  { id: 'trust', title: '民心所向', desc: '政府信任度達到 75', days: 1, check: e => e.s.stats.trust >= 75 },
  { id: 'wuwei', title: '無為而治', desc: '整局完全不出手干預', days: 1, check: e => e.s.day >= e.s.endDay && e.s.interventions === 0 },
  { id: 'not_alone', title: '我們並不孤單', desc: '收到來自深空的規律訊號', days: 1, check: e => e.s.eggs.includes('egg_alien_signal') },
  { id: 'sea_guest', title: '海上的訪客', desc: '鯨群游進台灣海峽', days: 1, check: e => e.s.eggs.includes('egg_whales_strait') },
  { id: 'lucky', title: '奇遇連連', desc: '同一局遇到 3 個彩蛋', days: 1, check: e => e.eggCount() >= 3 },
];
export const MILESTONE_LIST: Milestone[] = MILESTONES.map(({ id, title, desc }) => ({ id, title, desc }));

/** 一般十年局的終局平均與標準差（不干預 500 局），結局保底稱號用來判斷這局哪裡最不一樣 */
const TYPICAL: Partial<Record<StatKey, [number, number]>> = {
  intl: [78.6, 10.4], gdp: [48.8, 14.3], wealth: [49.2, 11.7], stability: [52.9, 14.4], tension: [39.6, 18.4],
  trust: [46.2, 13.0], defense: [56.2, 10.5], tech: [82.2, 10.5], demo: [33.6, 6.7],
};
/** 保底稱號：[偏高稱號, 偏低稱號, 偏高描述, 偏低描述] */
const FALLBACK: Record<string, [string, string, string, string]> = {
  intl: ['被看見的十年', '被遺忘的十年', '島嶼的名字越來越常出現在國際新聞裡。', '世界的目光漸漸移開，島嶼在國際上越來越安靜。'],
  gdp: ['經濟起飛的十年', '經濟下滑的十年', '產業與投資接連到位，經濟走出一條上坡路。', '訂單與投資一點一點流失，經濟走得越來越吃力。'],
  wealth: ['荷包飽滿的十年', '勒緊褲帶的十年', '薪水與存款都多了一些，日子過得比以前寬裕。', '物價追著薪水跑，家家戶戶都在精打細算。'],
  stability: ['安居的十年', '不安的十年', '街頭少了衝突，多數人能安心過日子。', '社會的情緒越來越緊繃，小事也容易引爆衝突。'],
  tension: ['緊繃的十年', '和緩的十年', '海峽兩岸的緊張一路升高，演習與警告成了日常。', '海峽兩岸的緊張慢慢降溫，日子少了些提心吊膽。'],
  trust: ['信任的十年', '疑慮的十年', '人們願意給政府多一點耐心，施政推得比較順。', '人們對政府的每句話都打上問號。'],
  defense: ['整軍的十年', '鬆懈的十年', '國防一年比一年紮實，島嶼的防衛更有底氣。', '國防投入節節後退，防衛的缺口越來越大。'],
  tech: ['科技躍進的十年', '科技停滯的十年', '新的技術與公司一個接一個誕生，島嶼站上浪頭。', '產業升級卡關，島嶼在科技競賽裡慢了下來。'],
  demo: ['年輕的十年', '老去的十年', '新生兒與年輕人回來了，城鎮重新熱鬧起來。', '學校併校、街上長者越來越多，島嶼一年比一年老。'],
};

/** 成果指數：結局評分與即時顯示共用；緊張與依賴是對稱的兩種外部風險 */
export function guardianScore(st: Record<StatKey, number>, dep: number): number {
  return Math.round((st.stability + st.wealth + st.gdp + st.trust + st.intl) / 5
    - Math.max(0, st.tension - 50) * 0.5 - Math.max(0, dep - 50) * 0.5 + st.demo * 0.1);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clampStat = (k: StatKey, v: number) => (LEAN.includes(k) ? clamp(v, -100, 100) : clamp(v, 0, 100));

/** 台北時間 ms → 當天 00:00 */
const twMidnight = (tw: number) => Math.floor(tw / DAY_MS) * DAY_MS;

export class Engine {
  readonly defs = new Map<string, EventDef>();
  private byTier: Record<Tier, EventDef[]> = { news: [], general: [], major: [] };
  /** 彩蛋另外抽：rate 只代表彩蛋之間的相對權重 */
  private eggPool: EventDef[] = [];
  rng: Rng;
  fate: Rng;
  hooks: Partial<EngineHooks> = {};

  constructor(events: EventDef[], public s: GameState) {
    for (const d of [...SYSTEM_EVENTS, ...events]) {
      this.defs.set(d.id, d);
      if (d.chainOnly) continue;
      if (d.egg) this.eggPool.push(d); else this.byTier[d.tier].push(d);
    }
    s.fateRng ??= (s.seed ^ 0x9e3779b9) >>> 0;
    this.rng = new Rng(s.rng);
    this.fate = new Rng(s.fateRng);
    Engine.migrate(s, this.defs);
  }

  /** 舊存檔補上新欄位，並移除已不存在的事件，避免讀檔後出錯 */
  private static migrate(s: GameState, defs: Map<string, EventDef>) {
    s.hidden.dep ??= 40;
    s.policies ??= [];
    s.chains ??= [];
    s.interventions ??= s.log.filter(l => l.intervened).length;
    s.achieved ??= [];
    s.streak ??= {};
    s.reviews ??= Math.floor(s.day / REVIEW_DAYS);
    s.eggs ??= [];
    s.pending = s.pending.filter(p => defs.has(p.eventId));
    for (const p of s.pending) p.expiresDay = Infinity;
    s.scheduled = s.scheduled.filter(x => defs.has(x.id));
  }

  // ---------- 開局 ----------

  static newGame(countyNames: { name: string; neighbors: string[] }[], seed: number, nowUtc: number): GameState {
    const rng = new Rng(seed);
    const startTw = nowUtc + TW_OFFSET;
    const startDayTw = twMidnight(startTw);
    const start = new Date(startTw);
    const end = new Date(startTw);
    end.setUTCFullYear(start.getUTCFullYear() + YEARS);
    const endDay = Math.round((twMidnight(end.getTime()) - startDayTw) / DAY_MS);

    const idx = new Map(countyNames.map((c, i) => [c.name, i]));
    const links = countyNames.map(c => new Set(c.neighbors.map(n => idx.get(n)!).filter(n => n !== undefined)));
    for (const [a, b] of SEA_LINKS) {
      const ia = idx.get(a), ib = idx.get(b);
      if (ia !== undefined && ib !== undefined) { links[ia].add(ib); links[ib].add(ia); }
    }
    const lean0 = rng.normal() * 4;
    const counties: County[] = countyNames.map((c, i) => {
      const base = COUNTY_BASE[c.name] ?? { pop: 10, wealthOffset: 0 };
      return {
        name: c.name, pop: base.pop, wealthOffset: base.wealthOffset, links: [...links[i]],
        popLean: clamp(lean0 + rng.normal() * 6, -100, 100),
        stability: clamp(70 + rng.normal() * 3, 0, 100),
        wealth: clamp(55 + base.wealthOffset + rng.normal() * 2, 0, 100),
      };
    });

    const s: GameState = {
      version: 1, seed, rng: rng.s, fateRng: (seed ^ 0x9e3779b9) >>> 0, startTw, startDayTw, day: 0, endDay,
      stats: {
        govLean: clamp(rng.normal() * 5, -100, 100), popLean: 0, intl: 60, gdp: 62, wealth: 0, stability: 0,
        tension: 45, trust: 50, defense: 45, tech: 80, demo: 40,
      },
      counties, hidden: { econ: 0, stance: 0, identity: 0, mood: 0, dep: 40 }, policies: [], chains: [], divine: 5,
      interventions: 0, achieved: [], streak: {}, reviews: 0, eggs: [],
      cooldown: {}, once: [], ongoing: [], scheduled: [], pending: [], history: [], log: [], uid: 1,
      lowStab: 0, lowEcon: 0, ended: null,
    };
    // 固定排程：九合一（每四年 11 月最後一個週六）、總統大選（每四年 1 月第二個週六）
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
      if (y % 4 === 2) Engine.schedule(s, Engine.nthSaturday(y, 10, -1), 'sys_local_election');
      if (y % 4 === 0) Engine.schedule(s, Engine.nthSaturday(y, 0, 2), 'sys_pres_election');
    }
    Engine.aggregate(s);
    s.history.push({ day: 0, s: STAT_ORDER.map(k => s.stats[k]) });
    return s;
  }

  /** 某月第 n 個週六（n = -1 為最後一個），回傳台北時間 ms */
  private static nthSaturday(year: number, month: number, n: number): number {
    if (n > 0) {
      const first = new Date(Date.UTC(year, month, 1));
      const offset = (6 - first.getUTCDay() + 7) % 7;
      return Date.UTC(year, month, 1 + offset + (n - 1) * 7);
    }
    const last = new Date(Date.UTC(year, month + 1, 0));
    const back = (last.getUTCDay() - 6 + 7) % 7;
    return Date.UTC(year, month, last.getUTCDate() - back);
  }

  private static schedule(s: GameState, dateTw: number, id: string) {
    const day = Math.round((dateTw - s.startDayTw) / DAY_MS);
    if (day > 0 && day < s.endDay) s.scheduled.push({ day, id });
  }

  // ---------- 讀值 ----------

  read(k: ReadKey): number {
    const st = this.s.stats;
    switch (k) {
      case 'gap': return Math.abs(st.govLean - st.popLean);
      case 'absGov': return Math.abs(st.govLean);
      case 'absPop': return Math.abs(st.popLean);
      case 'elapsed': return this.s.day / 365.25;
      case 'year': return new Date(this.dateTw()).getUTCFullYear();
      case 'dep': return this.s.hidden.dep;
      default: return st[k];
    }
  }

  private norm(k: ReadKey): number {
    const v = this.read(k);
    if (k === 'govLean' || k === 'popLean' || k === 'gap' || k === 'absGov' || k === 'absPop') return v / 100;
    if (k === 'elapsed') return v / YEARS;
    if (k === 'year') return (v - new Date(this.s.startTw).getUTCFullYear()) / YEARS;
    return (v - 50) / 50;
  }

  private modFactor(mods?: { stat: ReadKey; k: number }[]): number {
    if (!mods) return 1;
    let x = 0;
    for (const m of mods) x += m.k * this.norm(m.stat);
    return Math.exp(clamp(x, -6, 6));
  }

  /** 目前日期（台北時間 ms，當天 00:00） */
  dateTw(day = this.s.day): number { return this.s.startDayTw + day * DAY_MS; }

  // ---------- 每日推進 ----------

  tick() {
    const s = this.s;
    if (s.ended || this.blocking()) return;
    s.day++;

    if (s.day % DIVINE_EVERY === 0 && s.divine < DIVINE_MAX) {
      s.divine++;
      this.hooks.divine?.(s.divine);
    }

    s.ongoing = s.ongoing.filter(o => {
      this.applyEffects(o.perDay);
      return --o.days > 0;
    });

    this.dynamics();
    Engine.aggregate(s);

    // 排程事件（選舉、事件鏈）
    const due = s.scheduled.filter(x => x.day <= s.day);
    s.scheduled = s.scheduled.filter(x => x.day > s.day);
    for (const d of due) {
      const def = this.defs.get(d.id);
      if (!def) continue;
      // 同一天只能有一件重大事件（含奇遇），其餘順延一天
      if ((def.tier === 'major' || def.egg) && this.blocking()) s.scheduled.push({ day: s.day + 1, id: d.id });
      else this.fire(def);
    }

    // 隨機事件
    // 每個層級每天固定抽兩個亂數（是否發生、抽哪一件），不論結果如何，
    // 讓同一個種子碼的玩家即使選擇不同，事件發生的時間點仍保持一致
    for (const tier of ['news', 'general', 'major'] as Tier[]) {
      const roll = this.rng.next(), u = this.rng.next();
      if (tier === 'major' && (this.blocking() || s.day < 20)) continue;
      if (roll < (tier === 'major' ? this.majorRate() : TIER_RATE[tier]) / 365) {
        const def = this.draw(tier, u);
        if (def) this.fire(def);
      }
    }

    // 彩蛋：同樣每天固定抽兩個亂數，維持同種子玩家的事件節奏一致
    const eggRoll = this.rng.next(), eggU = this.rng.next();
    if (eggRoll < EGG_RATE / 365 && !this.blocking() && s.day >= 20) {
      const pool = this.eggPool.filter(d => this.eligible(d));
      const i = pickWith(eggU, pool.map(d => d.rate * this.modFactor(d.mods)));
      if (i >= 0) this.fire(pool[i]);
    }

    this.systemChecks();
    this.checkChains();
    this.checkMilestones();

    if (s.day % 30 === 0) s.history.push({ day: s.day, s: STAT_ORDER.map(k => +s.stats[k].toFixed(1)) });
    if (s.day >= s.endDay && !s.ended) this.end('timeup');
    s.rng = this.rng.s;
    s.fateRng = this.fate.s;
  }

  /**
   * 重大事件每年頻率：同一局不重複，事件池有限，
   * 依「尚未出現的件數 ÷ 剩餘年數」調節，讓整局都分得到重大事件，不會前段就用完
   */
  private majorRate(): number {
    const s = this.s;
    const left = this.byTier.major.filter(d => d.rate > 0 && !s.once.includes(d.id)).length;
    const years = Math.max(1, (s.endDay - s.day) / 365.25);
    // 倍率略小於 1：有些事件要到後期才符合條件，前面先留一點空間
    return clamp(left * MAJOR_PACE / years, MAJOR_RATE_MIN, TIER_RATE.major);
  }

  /** 每日的數值連動：各數值緩慢趨向由其他數值決定的平衡點 */
  private dynamics() {
    const s = this.s, st = s.stats, h = s.hidden, r = this.rng;
    const relax = (k: StatKey, target: number, rate: number) => {
      st[k] = clampStat(k, st[k] + (clampStat(k, target) - st[k]) * rate);
    };
    const elapsed = s.day / 365.25;
    const gap = Math.abs(st.govLean - st.popLean);
    s.policies = s.policies.filter(p => p.until > s.day);
    // 政策移動平衡點；多項政策可疊加，但效果打折避免長期一路墊高。出手留下的偏移另外計算
    // 民心是施政的槓桿：信任 0 時政策只剩 0.6 倍效果，信任 100 時 1.4 倍
    const lever = 0.6 + 0.8 * st.trust / 100;
    const pol = (k: StatKey) => lever * s.policies.reduce((a, p) => (p.stat !== k ? a : a + (p.hand ? this.handWeight(p) : POLICY_IMPACT) * p.shift), 0);
    // 門檻型的惡性循環：社會動盪拖垮經濟與信任、經濟低迷造成人才外流
    const unrest = Math.max(0, 35 - st.stability);
    const drain = Math.max(0, 40 - st.gdp);

    // 隱藏因子（AR(1) 隨機漫步）：全球景氣、對岸態度、世代認同趨勢、社會氛圍
    h.econ = clamp(h.econ * 0.998 + r.normal() * 0.032, -1, 1);
    h.stance = clamp(h.stance * 0.999 + r.normal() * 0.04, -1, 1);
    h.identity = clamp(h.identity * 0.999 + r.normal() * 0.024, -1, 1);
    h.mood = clamp(h.mood * 0.998 + r.normal() * 0.036, -1, 1);
    // 經濟依賴度：與兩岸緊張度完全鏡像（同一起點、相反斜率、同樣的影響與門檻），
    // 偏向獨立推高緊張、偏向統一推高依賴，兩端各有代價
    // 斜率略大於緊張度，用以抵銷事件層面施壓事件較多的落差（以 tools/simulate.ts 的偏統／偏獨機器人校準）
    h.dep = clamp(h.dep + (40 - st.govLean * 0.5 - st.popLean * 0.1 - h.stance * 30
      - (st.tech - 80) * 0.05 - (st.intl - 50) * 0.05 - h.dep) * 0.004, 0, 100);

    relax('gdp', 0.3 * st.tech + 0.15 * st.intl + 0.15 * st.stability + 0.15 * (100 - st.tension)
      - 0.15 * (h.dep - 40) + 0.1 * st.demo + 0.15 * st.trust + h.econ * 22 - 4 - unrest * 0.4 + pol('gdp'), 0.0025);
    relax('trust', 15 + 0.25 * st.stability + 0.25 * st.wealth + 0.1 * st.gdp - gap * 0.25 - unrest * 0.3 + pol('trust'), 0.003);
    relax('tension', 40 + st.govLean * 0.4 + st.popLean * 0.1 + h.stance * 30
      - (st.defense - 50) * 0.05 - (st.intl - 50) * 0.05 + pol('tension'), 0.004);
    // 國際關注隨任一種外部風險升高（緊張或依賴）
    relax('intl', 10 + 0.4 * st.tech + 0.2 * st.gdp + 0.2 * Math.max(st.tension, h.dep) + Math.abs(st.govLean) * 0.05
      + pol('intl'), 0.002);
    relax('defense', -2 + 0.25 * st.gdp + 0.35 * st.tension + 0.1 * st.intl + 0.15 * st.tech + pol('defense'), 0.0012);
    relax('tech', 25 + 0.3 * st.gdp + 0.15 * st.intl + 0.15 * st.demo + 0.1 * st.stability
      + Math.max(0, st.intl - 70) * 0.15 - drain * 0.2 + pol('tech'), 0.0008);
    relax('demo', 5 + 0.3 * st.wealth + 0.2 * st.stability + 0.05 * st.trust - elapsed * 0.6 - drain * 0.2 + pol('demo'), 0.0006);
    // 政府逐步回應民意（信任越高越穩定、越不需要急轉）
    relax('govLean', st.popLean, 0.0005);

    const shared = r.normal() * 0.1 + h.identity * 0.035;
    // 信任 45 以上，民意慢慢跟著政府走；低於 45 則往遠離政府立場的方向反彈
    const follow = 0.0012 * (st.trust - 45) / 50;
    const cs = s.counties;
    const avgOf = (c: County, k: CountyStatKey) =>
      c.links.length ? c.links.reduce((a, j) => a + cs[j][k], 0) / c.links.length : c[k];
    const next = cs.map(c => ({
      popLean: c.popLean
        + (avgOf(c, 'popLean') - c.popLean) * 0.003
        + (st.popLean - c.popLean) * 0.002
        + (st.govLean - c.popLean) * follow
        - c.popLean * 0.0003
        + shared + r.normal() * 0.12,
      stability: c.stability
        + (avgOf(c, 'stability') - c.stability) * 0.004
        + (0.35 * c.wealth + 0.3 * st.trust - (st.tension - 50) * 0.25 - (h.dep - 50) * 0.25 + 23 + h.mood * 22
          - Math.abs(st.govLean - c.popLean) * 0.35 + pol('stability') - c.stability) * 0.004,
      wealth: c.wealth + (st.gdp * 0.85 + 6 + c.wealthOffset + pol('wealth') - c.wealth) * 0.0015,
    }));
    cs.forEach((c, i) => {
      c.popLean = clamp(next[i].popLean, -100, 100);
      c.stability = clamp(next[i].stability, 0, 100);
      c.wealth = clamp(next[i].wealth, 0, 100);
    });
  }

  /** 縣市值依人口加權，彙整為國家值 */
  static aggregate(s: GameState) {
    let tp = 0;
    const sum: Record<CountyStatKey, number> = { popLean: 0, stability: 0, wealth: 0 };
    for (const c of s.counties) {
      tp += c.pop;
      for (const k of COUNTY_KEYS) sum[k] += c[k] * c.pop;
    }
    for (const k of COUNTY_KEYS) s.stats[k] = sum[k] / tp;
  }

  private checkChains() {
    const s = this.s, st = s.stats;
    for (const c of CHAINS) {
      const active = s.chains.includes(c.id);
      if (!active && c.on(st)) { s.chains.push(c.id); this.hooks.chain?.(c, true); }
      else if (active && c.off(st)) { s.chains = s.chains.filter(x => x !== c.id); this.hooks.chain?.(c, false); }
    }
  }

  private systemChecks() {
    const s = this.s, st = s.stats;
    const ready = (id: string) => (s.cooldown[id] ?? 0) <= s.day;
    if (!this.blocking()) {
      if (st.tension >= 85 && ready('sys_brink')) this.fire(this.defs.get('sys_brink')!);
      else if (s.hidden.dep >= 85 && ready('sys_dep_crisis')) this.fire(this.defs.get('sys_dep_crisis')!);
      else if (st.govLean >= 50 && st.popLean >= 25 && ready('sys_indep')) this.fire(this.defs.get('sys_indep')!);
      else if (st.govLean <= -50 && st.popLean <= -25 && ready('sys_unify')) this.fire(this.defs.get('sys_unify')!);
    }
    s.lowStab = st.stability <= 8 ? s.lowStab + 1 : Math.max(0, s.lowStab - 2);
    s.lowEcon = st.gdp <= 10 && st.wealth <= 15 ? s.lowEcon + 1 : Math.max(0, s.lowEcon - 2);
    if (s.lowStab >= 60) this.end('collapse');
    else if (s.lowEcon >= 90) this.end('bankrupt');
  }

  // ---------- 事件 ----------

  private eligible(d: EventDef): boolean {
    const s = this.s;
    if ((s.cooldown[d.id] ?? 0) > s.day) return false;
    if ((d.once || Engine.oncePerGame(d)) && s.once.includes(d.id)) return false;
    if (d.egg && !d.chainOnly && this.eggCount() >= EGG_CAP) return false;
    if (s.pending.some(p => p.eventId === d.id)) return false;
    for (const [k, op, v] of d.cond ?? []) {
      const x = this.read(k);
      if (op === '<' ? !(x < v) : op === '<=' ? !(x <= v) : op === '>' ? !(x > v) : !(x >= v)) return false;
    }
    return true;
  }

  private draw(tier: Tier, u: number): EventDef | null {
    const pool = this.byTier[tier].filter(d => this.eligible(d));
    const i = pickWith(u, pool.map(d => d.rate * this.modFactor(d.mods)));
    return i < 0 ? null : pool[i];
  }

  /** 由「種子＋日期＋事件＋用途」決定的亂數：不消耗任何亂數序列 */
  private hashRand(id: string, salt: string): number {
    let h = 0x811c9dc5 ^ this.s.seed;
    for (const ch of `${this.s.day}|${id}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }

  /** 發生地點：縣市索引或命名地點 */
  private locate(d: EventDef): { county: number | null; point: string | null } {
    const cs = this.s.counties;
    const randomCounty = () => pickWith(this.hashRand(d.id, 'county'), cs.map(c => c.pop));
    if (typeof d.loc === 'string') {
      if (d.loc === 'random') return { county: randomCounty(), point: null };
      if (NAMED_POINTS[d.loc]) return { county: null, point: d.loc };
      const i = cs.findIndex(c => c.name === d.loc);
      return { county: i >= 0 ? i : randomCounty(), point: null };
    }
    const options = d.loc.map(n => cs.findIndex(c => c.name === n)).filter(i => i >= 0);
    const points = d.loc.filter(n => NAMED_POINTS[n]);
    const all = [...options.map(i => ({ county: i, point: null })), ...points.map(p => ({ county: null, point: p }))];
    if (!all.length) return { county: randomCounty(), point: null };
    return all[Math.floor(this.hashRand(d.id, 'loc') * all.length)];
  }

  placeName(p: { county: number | null; point: string | null }): string {
    if (p.county !== null) return this.s.counties[p.county].name;
    if (p.point) return NAMED_POINTS[p.point]?.label ?? '';
    return '';
  }

  text(t: string, p: { county: number | null; point: string | null }) {
    return t.replaceAll('{county}', this.placeName(p));
  }

  private fire(def: EventDef) {
    const s = this.s;
    s.cooldown[def.id] = s.day + (def.cooldown ?? DEFAULT_COOLDOWN[def.tier]);
    // 重大事件同一局只出現一次（含事件鏈排程的後續重大事件）
    if (Engine.oncePerGame(def) && s.once.includes(def.id)) return;
    if ((def.once || Engine.oncePerGame(def)) && !s.once.includes(def.id)) s.once.push(def.id);
    if (def.egg) s.eggs.push(def.id);
    const loc = this.locate(def);
    const opts = def.options ?? [];

    if (def.tier === 'news' || !opts.length) {
      // 隨機挑一種寫法，避免同一句反覆出現
      const forms = [{ title: def.title, desc: def.desc }, ...(def.variants ?? [])];
      const form = forms[Math.floor(this.hashRand(def.id, 'form') * forms.length)];
      const before = this.snapshot();
      if (def.effects) this.applyEffects(scaleNews(def.effects));
      if (def.local && loc.county !== null) this.applyLocal(scaleNews(def.local) as typeof def.local, loc.county);
      Engine.aggregate(s);
      const e: LogEntry = {
        day: s.day, eventId: def.id, title: this.text(form.title, loc), desc: this.text(form.desc ?? def.desc, loc),
        cat: def.cat, tier: 'news', place: this.placeName(loc), ...loc, option: -1, intervened: false, deltas: this.diff(before),
      };
      this.pushLog(e);
      this.hooks.news?.(e);
      return;
    }

    // 奇遇（彩蛋）和重大事件一樣：時間暫停、必須當下決定
    const tier: Tier = def.egg ? 'major' : def.tier;
    if (tier === 'general') {
      const gen = s.pending.filter(p => p.tier === 'general');
      if (gen.length >= MAX_PENDING) this.resolve(gen[0].uid, null);
    }
    const p: Pending = {
      uid: s.uid++, eventId: def.id, tier, ...loc,
      createdDay: s.day, expiresDay: Infinity,
    };
    s.pending.push(p);
    if (tier === 'major') this.hooks.major?.(p);
    else this.hooks.pending?.(p);
  }

  /** 有重大事件等待決定時，時間停止 */
  blocking(): Pending | undefined {
    return this.s.pending.find(p => p.tier === 'major');
  }

  /** 不干預時各選項的自然機率 */
  probs(def: EventDef): number[] {
    const w = (def.options ?? []).map(o => o.weight * this.modFactor(o.mods));
    const t = w.reduce((a, b) => a + b, 0) || 1;
    return w.map(x => x / t);
  }

  /** 干預某選項的命運花費：影響越大、越要扭轉自然命運越貴 */
  cost(def: EventDef, i: number): number {
    const o = def.options![i];
    if (o.cost !== undefined) return o.cost;
    const p = this.probs(def)[i];
    const sumAbs = (e?: Effects) => Object.entries(e ?? {})
      .reduce((a, [k, v]) => a + Math.abs(v as number) * (k === 'govToPop' || k === 'popToGov' ? 20 : 1), 0);
    const mag = sumAbs(o.effects) + sumAbs(o.over?.effects) * 0.7
      + Object.values(o.local ?? {}).reduce((a, v) => a + Math.abs(v as number) * 0.25, 0);
    const base = o.ending ? 8 : 1 + mag / 7 + (1 - p) * 4;
    return clamp(Math.round(base), 1, 12);
  }

  /** 結算事件。option 為 null 表示交給自然命運；intervene 時扣除命運 */
  resolve(uid: number, option: number | null): LogEntry | null {
    const s = this.s;
    const p = s.pending.find(x => x.uid === uid);
    if (!p) return null;
    const def = this.defs.get(p.eventId)!;
    const opts = def.options!;
    let i = option ?? -1;
    const intervened = option !== null;
    if (intervened) {
      const c = this.cost(def, i);
      if (s.divine < c) return null;
      s.divine -= c;
      s.interventions++;
    } else {
      i = this.fate.pick(this.probs(def));
      if (p.tier === 'major') s.divine = Math.min(DIVINE_MAX, s.divine + 1); // 順其自然的回饋（重大事件與奇遇）
    }
    s.pending = s.pending.filter(x => x.uid !== uid);
    const o = opts[i];
    const before = this.snapshot();
    this.applyOption(o, p, intervened);
    if (def.id === 'sys_pres_election') {
      s.stats.govLean = clamp(s.stats.govLean + this.fate.normal() * 6, -100, 100);
    }
    Engine.aggregate(s);
    const e: LogEntry = {
      day: s.day, eventId: def.id, title: this.text(def.title, p), cat: def.cat, tier: def.tier, place: this.placeName(p),
      county: p.county, point: p.point, option: i, optionText: o.text, intervened, result: o.result, deltas: this.diff(before),
    };
    this.pushLog(e);
    this.hooks.resolved?.(e, p);
    s.fateRng = this.fate.s;
    if (o.ending) this.end(o.ending);
    return e;
  }

  /** 出手偏移目前的權重：前段全額，最後 HAND.fade 天線性淡出 */
  private handWeight(p: { until: number }) {
    const left = p.until - this.s.day;
    return left >= HAND.fade ? 1 : Math.max(0, left / HAND.fade);
  }

  /** 主動出手：把立即效果的一部分轉成平衡點偏移 */
  handShift(e: Effects) {
    const s = this.s;
    for (const k of HAND_STATS) {
      const v = (e as any)[k] as number | undefined;
      if (!v) continue;
      s.policies.push({ stat: k, shift: v * HAND.shift, hand: true, from: s.day, until: HAND.days === null ? FOREVER : s.day + HAND.days });
    }
  }

  /** 玩家目前對某數值平衡點的推動量（介面顯示用） */
  handTotal(k: StatKey) {
    return this.s.policies.reduce((a, p) => (p.hand && p.stat === k ? a + this.handWeight(p) * p.shift : a), 0);
  }

  private applyOption(o: OptionDef, p: Pending, intervened = false) {
    if (o.effects) {
      const eff = scaleEffects(o.effects);
      this.applyEffects(eff);
      if (intervened) this.handShift(eff);
    }
    for (const pl of o.policy ?? []) {
      if (POLICY_STATS.includes(pl.stat)) this.s.policies.push({ stat: pl.stat, shift: pl.shift, until: this.s.day + pl.days });
    }
    if (o.local && p.county !== null) this.applyLocal(scaleEffects(o.local) as typeof o.local, p.county);
    if (o.over && o.over.days > 0) {
      const d = o.over.days;
      const perDay: Effects = {};
      for (const [k, v] of Object.entries(scaleEffects(o.over.effects))) {
        (perDay as any)[k] = k === 'govToPop' || k === 'popToGov' ? 1 - Math.pow(1 - (v as number), 1 / d) : (v as number) / d;
      }
      this.s.ongoing.push({ perDay, days: d });
    }
    for (const f of o.follow ?? []) {
      if (this.fate.next() < (f.chance ?? 1) && this.defs.has(f.id)) {
        this.s.scheduled.push({ day: this.s.day + Math.max(1, f.delay), id: f.id });
      }
    }
  }

  private applyEffects(e: Effects) {
    const s = this.s, st = s.stats;
    for (const [k, raw] of Object.entries(e)) {
      const v = raw as number;
      if (k === 'govToPop') st.govLean += (st.popLean - st.govLean) * v;
      else if (k === 'popToGov') for (const c of s.counties) c.popLean += (st.govLean - c.popLean) * v;
      else if (k === 'dep') s.hidden.dep = clamp(s.hidden.dep + v, 0, 100);
      else if ((COUNTY_KEYS as string[]).includes(k)) for (const c of s.counties) (c as any)[k] += v;
      else if (k in st) st[k as StatKey] += v;
    }
    for (const k of STAT_ORDER) st[k] = clampStat(k, st[k]);
    for (const c of s.counties) for (const k of COUNTY_KEYS) c[k] = clampStat(k, c[k]);
  }

  private applyLocal(local: Partial<Record<CountyStatKey, number>>, ci: number) {
    const cs = this.s.counties;
    for (const [k, v] of Object.entries(local) as [CountyStatKey, number][]) {
      cs[ci][k] = clampStat(k, cs[ci][k] + v);
      for (const j of cs[ci].links) cs[j][k] = clampStat(k, cs[j][k] + v * 0.5);
    }
  }

  private snapshot() { return { ...this.s.stats }; }

  private diff(before: Record<StatKey, number>) {
    const out: Partial<Record<StatKey, number>> = {};
    for (const k of STAT_ORDER) {
      const d = this.s.stats[k] - before[k];
      if (Math.abs(d) >= 0.3) out[k] = +d.toFixed(1);
    }
    return out;
  }

  private pushLog(e: LogEntry) {
    const log = this.s.log;
    log.push(e);
    if (log.length > 400) {
      // 重大事件與玩家干預整局保留（結局回顧要用），其他從最舊的開始捨棄
      const i = log.findIndex(l => l.tier !== 'major' && !l.intervened);
      log.splice(Math.max(0, i), 1);
    }
  }

  private checkMilestones() {
    const s = this.s;
    for (const m of MILESTONES) {
      if (s.achieved.includes(m.id)) continue;
      s.streak[m.id] = m.check(this) ? (s.streak[m.id] ?? 0) + 1 : 0;
      if (s.streak[m.id] >= m.days) {
        s.achieved.push(m.id);
        this.hooks.achieved?.({ id: m.id, title: m.title, desc: m.desc });
      }
    }
  }

  /** 重大事件一局只出現一次；選舉、危機、宣告等系統事件（sys_）依規則可重複 */
  static oncePerGame(d: EventDef): boolean {
    return d.tier === 'major' && !d.id.startsWith('sys_');
  }

  /** 本局已出現的彩蛋數（不含後續事件） */
  eggCount(): number {
    return this.s.eggs.filter(id => !this.defs.get(id)?.chainOnly).length;
  }

  /** 目前的成果指數 */
  score() { return guardianScore(this.s.stats, this.s.hidden.dep); }

  /**
   * 平行世界：同一個種子、同一個開局時刻，全程順其自然跑到 untilDay。
   * 引擎是確定性的，因此可以和玩家實際走過的這一局直接比較。
   */
  static baseline(events: EventDef[], counties: { name: string; neighbors: string[] }[], s0: GameState, untilDay: number) {
    const s = Engine.newGame(counties, s0.seed, s0.startTw - TW_OFFSET);
    const e = new Engine(events, s);
    while (!s.ended && s.day < untilDay) {
      const b = e.blocking();
      if (b) e.resolve(b.uid, null); else e.tick();
    }
    return { history: s.history, score: e.score(), ended: s.ended, stats: { ...s.stats } };
  }

  // ---------- 結局 ----------

  private end(id: EndingId) {
    const s = this.s, st = s.stats;
    if (s.ended) return;
    const score = guardianScore(st, s.hidden.dep);
    const years = (s.day / 365.25).toFixed(1);
    let title = '', text = '';
    const leanDesc = describeLean(st.govLean);
    switch (id) {
      case 'war':
        title = '烽火';
        text = `第 ${years} 年，海峽的緊張越過了臨界點，衝突爆發。這座島嶼的命運，從此不再由日常的選擇決定。`;
        break;
      case 'collapse':
        title = '崩解';
        text = `第 ${years} 年，長期動盪讓社會秩序全面瓦解，政府失去治理能力。`;
        break;
      case 'bankrupt':
        title = '枯竭';
        text = `第 ${years} 年，經濟與民生同時崩潰，人才與資本大量出走，島嶼陷入長期蕭條。`;
        break;
      case 'indep':
        title = '宣告獨立';
        text = `第 ${years} 年，政府正式宣告獨立。`
          + (st.tension >= 75 ? '對岸反應極為強烈，區域局勢進入未知。' : '海峽兩岸在緊繃中維持著脆弱的平衡。')
          + (st.intl >= 70 ? '國際社會高度關注，多國呼籲各方克制。' : '國際社會反應冷淡，前路需要自己摸索。');
        break;
      case 'unify':
        title = '宣告統一';
        text = `第 ${years} 年，兩岸簽署統一協議。`
          + (st.stability < 45 ? '島內社會出現劇烈分歧。' : '社會在不安與期待中迎接轉變。')
          + (st.intl >= 70 ? '國際社會高度關注這項歷史性的變局。' : '國際社會對此反應平淡。');
        break;
      case 'timeup': {
        // 依這一局最突出的特徵命名：每個特徵算出「超過門檻多少」，取最大者；都沒超過時，取和一般局相比最突出的數值
        const dep = s.hidden.dep, gap = Math.abs(st.govLean - st.popLean);
        const scores: [string, number][] = [
          ['繁榮之島', Math.min(st.stability - 60, st.wealth - 54, st.gdp - 55) / 6],
          ['矽之盾', Math.min(st.tech - 91, st.intl - 84) / 5],
          ['臨界之島', (Math.max(st.tension, dep) - 66) / 8],
          ['風雨飄搖', (38 - st.stability) / 6],
          ['沉睡之島', Math.min(32 - st.demo, 47 - st.gdp) / 5],
          ['撕裂之島', (gap - 11) / 4],
          ['失信之島', (34 - st.trust) / 6],
          ['焦慮的富島', Math.min(st.wealth - 54, 48 - st.stability) / 5],
          ['世界的朋友', (st.intl - 92) / 4],
          ['鐵壁之島', (st.defense - 70) / 5],
          ['民心所向', Math.min(st.trust - 58, st.stability - 58) / 5],
          ['失落的十年', (35 - st.gdp) / 5],
          // 統獨方向兩端對稱
          ['漸行漸遠', (st.govLean - 28) / 8],
          ['漸行漸近', (-st.govLean - 28) / 8],
        ];
        const [best, bestV] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
        const flavor: Record<string, string> = {
          繁榮之島: '富足與安穩並存，這是許多世代夢想中的模樣。',
          矽之盾: '晶片與技術成了島嶼最堅實的護盾，全世界都無法忽視它。',
          臨界之島: dep >= st.tension
            ? '島嶼的經濟命脈繫於單一市場，任何風吹草動都牽動全局。'
            : '和平仍在，但海峽的弦繃得前所未有地緊。',
          風雨飄搖: '島嶼撐了下來，卻是在一次次的動盪之中勉強站穩。',
          沉睡之島: '人口老去、經濟停滯，島嶼在安靜中慢慢沉睡。',
          撕裂之島: '政府往一邊走，民意往另一邊去，這座島從未如此分歧。',
          失信之島: '人們不再相信政府說的話，每一項政策都在懷疑中推行。',
          焦慮的富島: '口袋滿了，心卻不安，富裕沒有換來平靜。',
          世界的朋友: '這座島成了國際社會不可或缺的夥伴，到哪裡都有人認得它。',
          鐵壁之島: '島嶼把自己武裝成一座堡壘，沒有人敢輕易靠近。',
          民心所向: '政府與人民站在一起，這是一座彼此信任的島。',
          失落的十年: '經濟一路下滑，整整十年，島嶼都在找回失去的東西。',
          漸行漸遠: '十年間，島嶼一步步走向自己的路，與對岸的距離越拉越遠。',
          漸行漸近: '十年間，兩岸的往來越來越密，距離一點一點縮短。',
        };
        if (bestV >= 0) title = best;
        else {
          // 保底：和一般十年局（不干預 500 局的終局平均與標準差）相比，偏離最多的數值
          const zOf = (k: StatKey) => (st[k] - TYPICAL[k]![0]) / TYPICAL[k]![1];
          const keys = Object.keys(TYPICAL) as StatKey[];
          const k = keys.reduce((a, b) => (Math.abs(zOf(b)) > Math.abs(zOf(a)) ? b : a));
          const [hiTitle, loTitle, hiText, loText] = FALLBACK[k];
          const hi = zOf(k) > 0;
          title = hi ? hiTitle : loTitle;
          flavor[title] = hi ? hiText : loText;
        }
        text = `${flavor[title]}十年過去，你陪著這座島嶼走到了今天。政府路線${leanDesc}，`
          + `社會${st.stability >= 60 ? '安穩' : st.stability >= 35 ? '時有波瀾' : '動盪不安'}，`
          + `人民${st.wealth >= 54 ? '富足' : st.wealth >= 40 ? '小康' : '困頓'}。`;
        break;
      }
    }
    // 這局遇過的彩蛋，在結局留下一句話
    const epilogues = s.eggs.map(x => this.defs.get(x)?.egg?.epilogue).filter((x): x is string => !!x);
    if (epilogues.length) text += [...new Set(epilogues)].join('');
    const survived = id !== 'war' && id !== 'collapse' && id !== 'bankrupt';
    s.ended = { id, day: s.day, title, text, score, survived };
    s.history.push({ day: s.day, s: STAT_ORDER.map(k => +s.stats[k].toFixed(1)) });
    this.hooks.ended?.(s.ended);
  }
}

/** 以給定的 u ∈ [0,1) 依權重選出索引；權重總和為 0 時回傳 -1 */
function pickWith(u: number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return -1;
  let r = u * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function describeLean(v: number): string {
  if (v <= -70) return '趨向宣告統一';
  if (v <= -35) return '偏向統一';
  if (v < -10) return '略偏統一';
  if (v <= 10) return '維持現狀';
  if (v < 35) return '略偏獨立';
  if (v < 70) return '偏向獨立';
  return '趨向宣告獨立';
}
