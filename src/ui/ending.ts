// 結局畫面：回顧文字、關鍵抉擇與精簡數據，版面以手機一次截圖為目標；每局結局另存一份，標題頁可重看
import { STAT_ORDER, DAY_MS, describeLean, type GameState, type Ending, type LogEntry } from '../sim/engine';
import type { StatKey } from '../sim/types';
import { STAT_META } from './meta';

const KEY = 'tgh-endings-v1';
const KEEP = 20;

export interface EndingRecord {
  v: 1;
  /** 結束時的真實日期（ISO 字串） */
  at: string;
  endId: string;
  title: string;
  kicker: string;
  text: string;
  recap: string[];
  moments: { date: string; title: string; choice: string; intervened: boolean }[];
  score: number;
  baseline: number;
  years: string;
  interventions: number;
  /** 依 STAT_ORDER 排列的最終數值 */
  stats: number[];
  milestones: string[];
  eggs: { title: string; stars: number }[];
  code?: string;
  seed: number;
  survived: boolean;
}

export function loadEndings(): EndingRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as EndingRecord[]; } catch { return []; }
}

export function saveEnding(r: EndingRecord) {
  const list = [r, ...loadEndings()].slice(0, KEEP);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 無痕模式 */ }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 回顧時比較的指標（統獨傾向另外用文字描述） */
const TREND_KEYS: StatKey[] = ['intl', 'gdp', 'wealth', 'stability', 'tension', 'trust', 'defense', 'tech', 'demo'];
/** 結局畫面上精簡顯示的指標 */
const MINI_KEYS: StatKey[] = ['stability', 'gdp', 'wealth', 'intl', 'trust', 'tension'];

const impact = (l: LogEntry) => Object.values(l.deltas ?? {}).reduce((a, b) => a + Math.abs(b ?? 0), 0);
const notable = (l: LogEntry) => l.tier === 'major' && !l.eventId.startsWith('sys_');
const arrive = (l: LogEntry) => l.cat === 'disaster' ? '來襲' : '浮上檯面';
/** 事件結果當子句用：去掉結尾標點，避免「。。」 */
const clause = (t: string | undefined, fallback: string) => (t ?? fallback).replace(/[。！!，、]+$/, '');

interface BuildInput {
  s: GameState;
  end: Ending;
  baseline: { score: number; ended: Ending | null };
  kicker: string;
  milestones: string[];
  eggs: { title: string; stars: number }[];
}

export function buildEnding({ s, end, baseline, kicker, milestones, eggs }: BuildInput): EndingRecord {
  const yearOf = (day: number) => new Date(s.startDayTw + day * DAY_MS).getUTCFullYear();
  const monthOf = (day: number) => {
    const d = new Date(s.startDayTw + day * DAY_MS);
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const statsAt = (day: number) => {
    let h = s.history[0];
    for (const x of s.history) { if (x.day > day) break; h = x; }
    return h.s;
  };
  const idx = (k: StatKey) => STAT_ORDER.indexOf(k);
  const years = end.day / 365.25;

  // ---- 分段回顧 ----
  const n = years >= 6 ? 3 : years >= 3 ? 2 : 1;
  const names = n === 3 ? ['最初的幾年', '中間的幾年', '最後的幾年'] : n === 2 ? ['前半段的日子', '後半段的日子'] : [`這短短 ${years.toFixed(1)} 年`];
  const recap: string[] = [];
  for (let i = 0; i < n; i++) {
    const d0 = Math.round(end.day * i / n), d1 = Math.round(end.day * (i + 1) / n);
    const a = statsAt(d0), b = i === n - 1 ? STAT_ORDER.map(k => s.stats[k]) : statsAt(d1);
    const inEra = s.log.filter(l => l.day >= d0 && l.day < d1 + (i === n - 1 ? 1 : 0));
    const majors = inEra.filter(notable);
    const picks = [...majors].sort((x, y) => (+y.intervened - +x.intervened) || impact(y) - impact(x));
    let p = `<b>${names[i]}</b>（${yearOf(d0)}–${yearOf(d1)}）`;
    const top = picks[0];
    if (top) {
      p += top.intervened
        ? `，「${top.title}」${arrive(top)}，你出手讓局勢走向「${top.optionText ?? ''}」：${clause(top.result, '局面就此改寫')}。`
        : `，「${top.title}」${arrive(top)}，你選擇順其自然：${clause(top.result, '島嶼撐了過去')}。`;
      const second = picks.find(x => x !== top && x.eventId !== top.eventId);
      if (second) p += `之後又遇上「${second.title}」，${clause(second.result, '島嶼撐了過去')}。`;
    } else {
      p += '，沒有掀起太大的風浪。';
    }
    // 最明顯的升降
    const deltas = TREND_KEYS.map(k => ({ k, d: b[idx(k)] - a[idx(k)] }));
    const up = deltas.filter(x => x.d >= 6).sort((x, y) => y.d - x.d)[0];
    const down = deltas.filter(x => x.d <= -6).sort((x, y) => x.d - y.d)[0];
    const from = (k: StatKey) => Math.round(a[idx(k)]), to = (k: StatKey) => Math.round(b[idx(k)]);
    const rise = up && `${STAT_META[up.k].label}由 ${from(up.k)} 升到 ${to(up.k)}`;
    const fall = down && `${STAT_META[down.k].label}從 ${from(down.k)} 滑落到 ${to(down.k)}`;
    p += rise && fall ? `${rise}，${fall}。` : rise ? `${rise}。` : fall ? `${fall}。` : '各項指標大致持平。';
    recap.push(p);
  }

  // ---- 你這隻手 ----
  const iv = s.interventions;
  const perYear = iv / Math.max(1, years);
  let hand = iv === 0
    ? '你始終沒有伸手，這座島走的每一步，都是它自己的選擇。'
    : `你一共出手 ${iv} 次，` + (perYear < 1 ? '多半靜觀其變，只在關鍵時刻推一把。'
      : perYear < 3 ? '在需要的時候果斷介入。' : '幾乎每一次風浪裡都有你的身影。');
  const diff = end.score - baseline.score;
  // 對照組：同一個種子碼、同樣的事件與運氣，但全程不出手
  if (iv > 0) hand += `如果你一次都沒出手，遇上同樣的事件與運氣，這座島${baseline.ended && baseline.ended.day <= end.day && baseline.ended.id !== 'timeup'
    ? `會在第 ${(baseline.ended.day / 365.25).toFixed(1)} 年走向「${baseline.ended.title}」，`
    : '會'}得到 ${baseline.score} 分；${diff > 0 ? `你的出手讓它多了 ${diff} 分` : diff < 0 ? `你的出手反而讓它少了 ${-diff} 分` : '你的出手幾乎沒有改變結果'}。`;
  // 時間走完的結局文字已描述政府路線
  if (end.id !== 'timeup') hand += `此刻政府路線${describeLean(s.stats.govLean)}，民意${describeLean(s.stats.popLean)}。`;
  recap.push(hand);

  // ---- 關鍵抉擇：影響最大的干預，不足再補重大事件 ----
  const chosen = s.log.filter(l => l.intervened && l.tier !== 'news' && !l.eventId.startsWith('sys_')).sort((x, y) => impact(y) - impact(x));
  const fill = s.log.filter(l => notable(l) && !l.intervened).sort((x, y) => impact(y) - impact(x));
  const seen = new Set<string>();
  const moments = [...chosen, ...fill].filter(l => !seen.has(l.eventId) && !!seen.add(l.eventId)).slice(0, 3)
    .sort((x, y) => x.day - y.day)
    .map(l => ({ date: monthOf(l.day), title: l.title, choice: l.optionText ?? '', intervened: l.intervened }));

  return {
    v: 1, at: new Date().toISOString(), endId: end.id, title: end.title, kicker, text: end.text, recap, moments,
    score: end.score, baseline: baseline.score, years: years.toFixed(1), interventions: iv,
    stats: STAT_ORDER.map(k => Math.round(s.stats[k])), milestones, eggs,
    code: s.code, seed: s.seed, survived: end.survived,
  };
}

/** 截圖區塊（結局畫面與過往結局共用） */
export function endingShotHtml(r: EndingRecord, base: string) {
  const val = (k: StatKey) => r.stats[STAT_ORDER.indexOf(k)];
  return `<div class="end-shot">
    <div class="end-hero" style="background-image: url('${base}assets/endings/${r.endId}.webp')">
      <div class="end-kicker">${esc(r.kicker)}</div>
      <div class="end-title">${esc(r.title)}</div>
    </div>
    <p class="end-text">${esc(r.text)}</p>
    <div class="end-score">
      <div class="main">成果指數<b>${r.score}</b></div>
      <div>若不出手<b>${r.baseline}</b></div>
      <div>走過<b>${esc(r.years)}<small>年</small></b></div>
      <div>出手<b>${r.interventions}<small>次</small></b></div>
    </div>
    <div class="end-sec">回顧</div>
    <div class="end-recap">${r.recap.map(p => `<p>${p}</p>`).join('')}</div>
    ${r.moments.length ? `<div class="end-sec">關鍵抉擇</div><ol class="end-moments">${r.moments.map(m =>
      `<li><time>${m.date}</time><span class="t">${esc(m.title)}</span><span class="c">${m.intervened ? '✋' : '☁'}${esc(m.choice)}</span></li>`).join('')}</ol>` : ''}
    <div class="end-mini">${MINI_KEYS.map(k => `<span>${STAT_META[k].short}<b>${val(k)}</b></span>`).join('')}</div>
    ${r.milestones.length ? `<div class="end-ms">🏅 ${r.milestones.map(esc).join('、')}</div>` : ''}
    ${r.eggs.length ? `<div class="end-eggs">✦ 本局奇遇：${r.eggs.map(e => `${esc(e.title)}<small>${'★'.repeat(e.stars)}</small>`).join('、')}</div>` : ''}
    <div class="end-brand">命運之手：台灣${r.code ? `・種子碼 <b>${esc(r.code)}</b>` : ''}</div>
  </div>`;
}

/** 完整數值格（收在「完整數據」裡） */
export function endingGridHtml(r: EndingRecord, extra = '') {
  return `<div class="end-grid">${extra}${STAT_ORDER.map((k, i) =>
    `<div>${STAT_META[k].label}<b>${STAT_META[k].lean ? describeLean(r.stats[i]) : r.stats[i]}</b></div>`).join('')}</div>`;
}
