import type {
  Category, CountyStatKey, Effects, EndingId, EventDef, OptionDef, ReadKey, StatKey, Tier,
} from './types';
import { Rng } from './rng';
import { COUNTY_BASE, NAMED_POINTS, SEA_LINKS } from './countyData';
import { SYSTEM_EVENTS } from './systemEvents';

export const DAY_MS = 86_400_000;
/** 遊戲一律使用台北時間（UTC+8）計算日期 */
export const TW_OFFSET = 8 * 3_600_000;
export const YEARS = 30;
export const DIVINE_MAX = 25;
export const DIVINE_EVERY = 24; // 每 N 天 +1 神力

/** 各層級每年平均事件數 */
const TIER_RATE: Record<Tier, number> = { news: 26, general: 12, major: 2.4 };
const DEFAULT_COOLDOWN: Record<Tier, number> = { news: 150, general: 365, major: 900 };
const GENERAL_WINDOW = 30; // 一般事件等待干預的天數
const MAX_PENDING = 3;

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
  rng: number;
  /** 開局時刻（台北時間 ms） */
  startTw: number;
  /** 開局當天 00:00（台北時間 ms） */
  startDayTw: number;
  day: number;
  endDay: number;
  stats: Record<StatKey, number>;
  counties: County[];
  hidden: { econ: number; stance: number; identity: number; mood: number };
  divine: number;
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
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clampStat = (k: StatKey, v: number) => (LEAN.includes(k) ? clamp(v, -100, 100) : clamp(v, 0, 100));

/** 台北時間 ms → 當天 00:00 */
const twMidnight = (tw: number) => Math.floor(tw / DAY_MS) * DAY_MS;

export class Engine {
  readonly defs = new Map<string, EventDef>();
  private byTier: Record<Tier, EventDef[]> = { news: [], general: [], major: [] };
  rng: Rng;
  hooks: Partial<EngineHooks> = {};

  constructor(events: EventDef[], public s: GameState) {
    for (const d of [...SYSTEM_EVENTS, ...events]) {
      this.defs.set(d.id, d);
      if (!d.chainOnly) this.byTier[d.tier].push(d);
    }
    this.rng = new Rng(s.rng);
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
      version: 1, seed, rng: rng.s, startTw, startDayTw, day: 0, endDay,
      stats: {
        govLean: clamp(rng.normal() * 5, -100, 100), popLean: 0, intl: 60, gdp: 62, wealth: 0, stability: 0,
        tension: 45, trust: 50, defense: 45, tech: 80, demo: 40,
      },
      counties, hidden: { econ: 0, stance: 0, identity: 0, mood: 0 }, divine: 5,
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
      default: return st[k];
    }
  }

  private norm(k: ReadKey): number {
    const v = this.read(k);
    if (k === 'govLean' || k === 'popLean' || k === 'gap' || k === 'absGov' || k === 'absPop') return v / 100;
    if (k === 'elapsed') return v / YEARS;
    if (k === 'year') return (v - 2026) / YEARS;
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
      if (def) this.fire(def);
    }

    // 逾期未干預的一般事件：交給天意
    for (const p of [...s.pending]) {
      if (p.tier !== 'major' && p.expiresDay <= s.day) this.resolve(p.uid, null);
    }

    // 隨機事件
    for (const tier of ['news', 'general', 'major'] as Tier[]) {
      if (tier === 'major' && (this.blocking() || s.day < 20)) continue;
      if (this.rng.next() < TIER_RATE[tier] / 365) {
        const def = this.draw(tier);
        if (def) this.fire(def);
      }
    }

    this.systemChecks();

    if (s.day % 30 === 0) s.history.push({ day: s.day, s: STAT_ORDER.map(k => +s.stats[k].toFixed(1)) });
    if (s.day >= s.endDay && !s.ended) this.end('timeup');
    s.rng = this.rng.s;
  }

  /** 每日的數值連動：各數值緩慢趨向由其他數值決定的平衡點 */
  private dynamics() {
    const s = this.s, st = s.stats, h = s.hidden, r = this.rng;
    const relax = (k: StatKey, target: number, rate: number) => {
      st[k] = clampStat(k, st[k] + (clampStat(k, target) - st[k]) * rate);
    };
    const elapsed = s.day / 365.25;
    const gap = Math.abs(st.govLean - st.popLean);

    // 隱藏因子（AR(1) 隨機漫步）：全球景氣、對岸態度、世代認同趨勢、社會氛圍
    h.econ = clamp(h.econ * 0.998 + r.normal() * 0.032, -1, 1);
    h.stance = clamp(h.stance * 0.999 + r.normal() * 0.03, -1, 1);
    h.identity = clamp(h.identity * 0.999 + r.normal() * 0.022, -1, 1);
    h.mood = clamp(h.mood * 0.998 + r.normal() * 0.03, -1, 1);

    relax('gdp', 0.3 * st.tech + 0.15 * st.intl + 0.15 * st.stability + 0.15 * (100 - st.tension)
      + 0.1 * st.demo + 0.15 * st.trust + h.econ * 20, 0.0025);
    relax('trust', 20 + 0.25 * st.stability + 0.25 * st.wealth - gap * 0.25, 0.003);
    relax('tension', 40 + st.govLean * 0.4 + st.popLean * 0.1 + h.stance * 30
      - (st.defense - 50) * 0.05 - (st.intl - 50) * 0.05, 0.004);
    relax('intl', 10 + 0.4 * st.tech + 0.2 * st.gdp + 0.2 * st.tension + Math.abs(st.govLean) * 0.05, 0.002);
    relax('defense', 10 + 0.25 * st.gdp + 0.35 * st.tension + 0.1 * st.intl, 0.0012);
    relax('tech', 25 + 0.3 * st.gdp + 0.15 * st.intl + 0.15 * st.demo + 0.1 * st.stability, 0.0008);
    relax('demo', 10 + 0.25 * st.wealth + 0.15 * st.stability + 0.05 * st.trust - elapsed * 0.6, 0.0006);
    // 政府逐步回應民意（信任越高越穩定、越不需要急轉）
    relax('govLean', st.popLean, 0.0005);

    const shared = r.normal() * 0.1 + h.identity * 0.035;
    const cs = s.counties;
    const avgOf = (c: County, k: CountyStatKey) =>
      c.links.length ? c.links.reduce((a, j) => a + cs[j][k], 0) / c.links.length : c[k];
    const next = cs.map(c => ({
      popLean: c.popLean
        + (avgOf(c, 'popLean') - c.popLean) * 0.003
        + (st.popLean - c.popLean) * 0.002
        + (st.govLean - c.popLean) * 0.0003
        - c.popLean * 0.0001
        + shared + r.normal() * 0.12,
      stability: c.stability
        + (avgOf(c, 'stability') - c.stability) * 0.004
        + (0.35 * c.wealth + 0.3 * st.trust - (st.tension - 50) * 0.25 + 32 + h.mood * 18
          - Math.abs(st.govLean - c.popLean) * 0.35 - c.stability) * 0.004,
      wealth: c.wealth + (st.gdp * 0.85 + 5 + c.wealthOffset - c.wealth) * 0.0015,
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

  private systemChecks() {
    const s = this.s, st = s.stats;
    const ready = (id: string) => (s.cooldown[id] ?? 0) <= s.day;
    if (!this.blocking()) {
      if (st.tension >= 90 && ready('sys_brink')) this.fire(this.defs.get('sys_brink')!);
      else if (st.govLean >= 85 && st.popLean >= 45 && ready('sys_indep')) this.fire(this.defs.get('sys_indep')!);
      else if (st.govLean <= -85 && st.popLean <= -45 && ready('sys_unify')) this.fire(this.defs.get('sys_unify')!);
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
    if (d.once && s.once.includes(d.id)) return false;
    if (s.pending.some(p => p.eventId === d.id)) return false;
    for (const [k, op, v] of d.cond ?? []) {
      const x = this.read(k);
      if (op === '<' ? !(x < v) : op === '<=' ? !(x <= v) : op === '>' ? !(x > v) : !(x >= v)) return false;
    }
    return true;
  }

  private draw(tier: Tier): EventDef | null {
    const pool = this.byTier[tier].filter(d => this.eligible(d));
    const i = this.rng.pick(pool.map(d => d.rate * this.modFactor(d.mods)));
    return i < 0 ? null : pool[i];
  }

  /** 發生地點：縣市索引或命名地點 */
  private locate(d: EventDef): { county: number | null; point: string | null } {
    const cs = this.s.counties;
    const randomCounty = () => this.rng.pick(cs.map(c => c.pop));
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
    return all[Math.floor(this.rng.next() * all.length)];
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
    if (def.once) s.once.push(def.id);
    const loc = this.locate(def);
    const opts = def.options ?? [];

    if (def.tier === 'news' || !opts.length) {
      const before = this.snapshot();
      if (def.effects) this.applyEffects(def.effects);
      if (def.local && loc.county !== null) this.applyLocal(def.local, loc.county);
      Engine.aggregate(s);
      const e: LogEntry = {
        day: s.day, eventId: def.id, title: def.title, cat: def.cat, tier: 'news',
        place: this.placeName(loc), ...loc, option: -1, intervened: false, deltas: this.diff(before),
      };
      this.pushLog(e);
      this.hooks.news?.(e);
      return;
    }

    if (def.tier === 'general') {
      const gen = s.pending.filter(p => p.tier === 'general');
      if (gen.length >= MAX_PENDING) this.resolve(gen[0].uid, null);
    }
    const p: Pending = {
      uid: s.uid++, eventId: def.id, tier: def.tier, ...loc,
      createdDay: s.day, expiresDay: def.tier === 'major' ? Infinity : s.day + GENERAL_WINDOW,
    };
    s.pending.push(p);
    if (def.tier === 'major') this.hooks.major?.(p);
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

  /** 干預某選項的神力花費：影響越大、越違逆天意越貴 */
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

  /** 結算事件。option 為 null 表示交給天意；intervene 時扣除神力 */
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
    } else {
      i = this.rng.pick(this.probs(def));
      if (def.tier === 'major') s.divine = Math.min(DIVINE_MAX, s.divine + 1); // 順其自然的回饋
    }
    s.pending = s.pending.filter(x => x.uid !== uid);
    const o = opts[i];
    const before = this.snapshot();
    this.applyOption(o, p);
    if (def.id === 'sys_pres_election') {
      s.stats.govLean = clamp(s.stats.govLean + this.rng.normal() * 6, -100, 100);
    }
    Engine.aggregate(s);
    const e: LogEntry = {
      day: s.day, eventId: def.id, title: def.title, cat: def.cat, tier: def.tier, place: this.placeName(p),
      county: p.county, point: p.point, option: i, optionText: o.text, intervened, result: o.result, deltas: this.diff(before),
    };
    this.pushLog(e);
    this.hooks.resolved?.(e, p);
    s.rng = this.rng.s;
    if (o.ending) this.end(o.ending);
    return e;
  }

  private applyOption(o: OptionDef, p: Pending) {
    if (o.effects) this.applyEffects(o.effects);
    if (o.local && p.county !== null) this.applyLocal(o.local, p.county);
    if (o.over && o.over.days > 0) {
      const d = o.over.days;
      const perDay: Effects = {};
      for (const [k, v] of Object.entries(o.over.effects)) {
        (perDay as any)[k] = k === 'govToPop' || k === 'popToGov' ? 1 - Math.pow(1 - (v as number), 1 / d) : (v as number) / d;
      }
      this.s.ongoing.push({ perDay, days: d });
    }
    for (const f of o.follow ?? []) {
      if (this.rng.next() < (f.chance ?? 1) && this.defs.has(f.id)) {
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
    this.s.log.push(e);
    if (this.s.log.length > 400) this.s.log.splice(0, this.s.log.length - 400);
  }

  // ---------- 結局 ----------

  private end(id: EndingId) {
    const s = this.s, st = s.stats;
    if (s.ended) return;
    const score = Math.round(
      (st.stability + st.wealth + st.gdp + st.trust + st.intl) / 5
      - Math.max(0, st.tension - 50) * 0.5 + st.demo * 0.1);
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
        const r = (k: StatKey) => st[k];
        if (r('stability') >= 70 && r('wealth') >= 65 && r('gdp') >= 65) title = '繁榮之島';
        else if (r('tech') >= 85 && r('intl') >= 75) title = '矽之盾';
        else if (r('tension') >= 80) title = '臨界之島';
        else if (r('stability') < 35) title = '風雨飄搖';
        else if (r('demo') < 20 && r('gdp') < 45) title = '沉睡之島';
        else if (Math.abs(r('govLean')) < 25) title = '現狀的三十年';
        else title = '平凡的日子';
        const flavor: Record<string, string> = {
          繁榮之島: '富足與安穩並存，這是許多世代夢想中的模樣。',
          矽之盾: '晶片與技術成了島嶼最堅實的護盾，全世界都無法忽視它。',
          臨界之島: '和平仍在，但海峽的弦繃得前所未有地緊。',
          風雨飄搖: '島嶼撐了下來，卻是在一次次的動盪之中勉強站穩。',
          沉睡之島: '人口老去、經濟停滯，島嶼在安靜中慢慢沉睡。',
          現狀的三十年: '三十年來，島嶼始終在兩端之間找到平衡。',
          平凡的日子: '沒有奇蹟，也沒有崩塌，日子就這樣一天天過去。',
        };
        text = `${flavor[title]}三十年過去，你守護這座島嶼走到了今天。政府路線${leanDesc}，`
          + `社會${st.stability >= 60 ? '安穩' : st.stability >= 35 ? '時有波瀾' : '動盪不安'}，`
          + `人民${st.wealth >= 60 ? '富足' : st.wealth >= 40 ? '小康' : '困頓'}。`;
        break;
      }
    }
    const survived = id !== 'war' && id !== 'collapse' && id !== 'bankrupt';
    s.ended = { id, day: s.day, title, text, score, survived };
    s.history.push({ day: s.day, s: STAT_ORDER.map(k => +s.stats[k].toFixed(1)) });
    this.hooks.ended?.(s.ended);
  }
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
