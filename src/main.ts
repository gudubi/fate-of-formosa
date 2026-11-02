import './style.css';
import * as THREE from 'three';
import { MapScene } from './render/mapScene';
import { COUNTIES, loadRaster } from './map/mapData';
import { lonLatToKm } from './map/projection';
import {
  Engine, DAY_MS, DIVINE_MAX, STAT_ORDER, MAX_PENDING, REVIEW_DAYS, MILESTONE_LIST, describeLean,
  type GameState, type LogEntry, type Pending, type Ending,
} from './sim/engine';
import { NAMED_POINTS } from './sim/countyData';
import type { StatKey } from './sim/types';
import { ALL_EVENTS } from './data/events';
import { validateEvents } from './sim/validate';
import { STAT_META, CAT_META, LAYERS, ramp, iconSvg, HAND_ICON, catColor, LEAN_NEG, LEAN_POS, type LayerKey } from './ui/meta';
import { sfx } from './audio/sfx';
import { entriesOn, entriesOnSync, loadMonth, KIND_LABEL, type HistoryKind } from './data/history';
import { optionPreview, lastingNote } from './ui/preview';
import { addRecord, loadRecords } from './ui/records';
import { buildEnding, saveEnding, loadEndings, endingShotHtml, endingGridHtml, type EndingRecord } from './ui/ending';
import { renderShareCard, shareOrDownload } from './ui/share';
import { randomCode, normalizeCode, codeToSeed } from './sim/seed';
import { animateDetails } from './ui/collapse';
import { recordEgg, eggParents, dexHtml, dexDetailHtml, dexProgress } from './ui/eggs';
import type { EventDef } from './sim/types';

const SPEEDS = [0, 4, 8, 16];       // 天／秒
// 開場：日期從中華民國建立（1912-01-01）開始以遊戲速度跳動，
// 接著指數加速穿越歷史，接近此刻時減速，銜接標準遊戲速度（約 12 秒）
const ROC_START_TW = Date.UTC(1912, 0, 1);
const INTRO_GROWTH = 2.0;           // 加速度（倍率每秒乘以 e^2）
const INTRO_PEAK = 6e8;             // 最高倍率：約每秒 19 年，讓年份清楚可見
const INTRO_SETTLE = 0.5;           // 接近此刻時的減速時間常數（秒）
const TICK_GAP = 70;                // 滴答聲最短間隔（毫秒）
const SAVE_KEY = 'tgh-save-v1';
/** 靜態檔的根路徑：建置時為相對路徑，遊戲可以放在任何子資料夾（例如 gudubi.com/games/fate-of-formosa/） */
const BASE = import.meta.env.BASE_URL;
const SETTINGS_KEY = 'tgh-settings-v1';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const isMobile = () => matchMedia('(max-width: 820px), (orientation: portrait) and (max-width: 1100px)').matches;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

if (import.meta.env.DEV) {
  const errs = validateEvents(ALL_EVENTS);
  if (errs.length) console.warn('事件資料錯誤', errs);
}

// ---------- 設定 ----------
type CamMode = 'all' | 'major' | 'off';
type MotionMode = 'auto' | 'full' | 'reduce';
// 預設只在重大事件移動鏡頭，避免畫面每幾秒就晃動
const settings: { cam: CamMode; motion: MotionMode } = { cam: 'major', motion: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
const reducedMotion = () => settings.motion === 'reduce'
  || (settings.motion === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches);
function applyMotion() {
  document.body.classList.toggle('reduce-motion', reducedMotion());
  if (map) map.reducedMotion = reducedMotion();
}

// ---------- 遊戲狀態 ----------
let map!: MapScene;
let eng: Engine | null = null;
let gameTw = 0;
let speed = 1;
let userPaused = false;
let phase: 'title' | 'intro' | 'play' | 'ended' = 'title';
let introT = 0;
let openUid: number | null = null;
let layer: LayerKey = 'terrain';
let selCounty: number | null = null;
let lastInteract = 0;
let lastSaveDay = 0;
let historyOpen = false;
let reviewOpen = false;
/** 擲骰動畫進行中：左側數值暫不更新，等結果揭曉才一起變動 */
let statsHold = false;
/** 左側目前顯示的數值，用來偵測變化並閃爍 */
let shownVals: Partial<Record<StatKey, number>> = {};
const bubbles = new Map<number, HTMLButtonElement>();

// ---------- 地點 ----------
function locXY(county: number | null, point: string | null): { x: number; y: number; zoom: number } {
  if (county !== null) {
    const l = map.raster.labels[county];
    return { x: l.x, y: l.y, zoom: 210 };
  }
  const p = NAMED_POINTS[point ?? 'world'] ?? NAMED_POINTS.world;
  const [x, y] = lonLatToKm(p.lon, p.lat);
  return { x, y, zoom: p.zoom };
}

// ---------- 標籤 ----------
const labelLayer = $('labels');
const countyLabels = COUNTIES.map(c => {
  const el = document.createElement('div');
  el.className = 'lbl'; el.textContent = c.name;
  labelLayer.appendChild(el);
  return el;
});
const NEIGHBOR_LABELS: [string, number, number][] = [
  ['中國', 117.6, 25.9], ['日本・八重山', 124.0, 24.65], ['菲律賓・巴丹', 121.9, 20.75],
];
const neighborLabels = NEIGHBOR_LABELS.map(([name, lon, lat]) => {
  const el = document.createElement('div');
  el.className = 'lbl nb'; el.textContent = name;
  labelLayer.appendChild(el);
  const [x, y] = lonLatToKm(lon, lat);
  return { el, x, y };
});

/** below = true 時標籤放在定位點正下方（縣市名稱），讓事件圖釘的尖端落在名稱上方而不遮住文字 */
function place(el: HTMLElement, x: number, yw: number, z: number, below = false): boolean {
  const p = map.toScreen(x, yw, z);
  if (!p) { el.style.display = 'none'; return false; }
  el.style.display = '';
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, ${below ? '4px' : '-50%'})`;
  return true;
}

let labelY: number[] = [];
function updateLabels() {
  const d = map.cameraDistance();
  const showCounty = d < (isMobile() ? 430 : 560);
  if (!labelY.length) labelY = map.raster.labels.map(l => map.surfaceY(l.x, l.y) + 1);
  countyLabels.forEach((el, i) => {
    el.style.opacity = showCounty ? '1' : '0';
    if (!showCounty) return;
    const l = map.raster.labels[i];
    place(el, l.x, labelY[i], l.y, true);
  });
  for (const n of neighborLabels) place(n.el, n.x, 1, n.y);
  for (const [uid, el] of bubbles) {
    const p = eng?.s.pending.find(x => x.uid === uid);
    if (!p) continue;
    const { x, y } = locXY(p.county, p.point);
    const s = map.toScreen(x, map.surfaceY(x, y) + 1, y);
    if (!s) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = `${s.x}px`; el.style.top = `${s.y}px`;
  }
}

// ---------- 時間與主迴圈 ----------
function currentRate(): number {
  // 遊戲毫秒 / 真實毫秒
  const target = SPEEDS[speed] * DAY_MS / 1000;
  if (phase === 'intro' && eng) {
    const accel = Math.min(INTRO_PEAK, target * Math.exp(INTRO_GROWTH * introT));
    const remain = eng.s.startTw - gameTw;
    return Math.min(accel, target + remain / (INTRO_SETTLE * 1000));
  }
  return target;
}

function frozen() {
  return !eng || !!eng.s.ended || !!eng.blocking() || openUid !== null || userPaused || historyOpen || reviewOpen;
}

function advance(dt: number) {
  if (frozen()) return;
  const e = eng!;
  if (phase === 'intro') introT += dt;
  const before = gameTw;
  gameTw += dt * 1000 * currentRate();
  if (phase === 'intro') {
    introTicks(before, gameTw);
    if (gameTw >= e.s.startTw) endIntro();
  }
  const target = Math.floor((gameTw - e.s.startDayTw) / DAY_MS);
  let n = 0;
  while (e.s.day < target && n++ < 64) {
    e.tick();
    if (e.blocking() || e.s.ended) break;
  }
  if (e.blocking() || e.s.ended) gameTw = Math.min(gameTw, e.dateTw(e.s.day + 1) - 1);
  if (e.s.day - lastSaveDay >= 60) { lastSaveDay = e.s.day; save(); }
  // 每五年回顧一次（重大事件處理完之後）
  if (phase === 'play' && !e.blocking() && !e.s.ended && Math.floor(e.s.day / REVIEW_DAYS) > e.s.reviews) openReview();
}

/** 滴答聲：每跨過一天一聲，加速後受最短間隔限制，形成由慢而快再放慢的節奏 */
let lastTick = 0;
function introTicks(from: number, to: number) {
  const now = performance.now();
  if (Math.floor(to / DAY_MS) > Math.floor(from / DAY_MS) && now - lastTick > TICK_GAP) {
    lastTick = now;
    sfx.play('tick');
  }
}

function endIntro() {
  if (phase !== 'intro') return;
  phase = 'play';
  gameTw = Math.max(gameTw, eng!.s.startTw);
  $('accel').hidden = true;
  histAcc = HISTORY_EVERY; // 立即換成此刻的歷史上的今天
  sfx.play('start');
}

let last = performance.now();
let uiAcc = 0;
let altAcc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (phase === 'intro' || phase === 'play') advance(dt);
  map.render(dt);
  updateLabels();
  uiAcc += dt;
  if (eng && uiAcc > 0.12) { uiAcc = 0; refreshHud(); }
  if (eng && phase !== 'title') {
    histAcc += dt;
    if (histAcc > HISTORY_EVERY) nextHistory();
    altAcc += dt;
    if (altAcc > 6) { altAcc = 0; $('hud').classList.toggle('alt'); }
  }
  if (phase === 'title') refreshTitleClock();
  requestAnimationFrame(frame);
}

// ---------- 頂列 ----------
function twDate(tw: number) { return new Date(tw); }
function dateStr(tw: number) {
  const d = twDate(tw);
  return `${d.getUTCFullYear()}年${String(d.getUTCMonth() + 1).padStart(2, '0')}月${String(d.getUTCDate()).padStart(2, '0')}日（${WEEK[d.getUTCDay()]}）`;
}
function shortDate(day: number) {
  const d = twDate(eng!.dateTw(day));
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
function timeStr(tw: number) {
  const d = twDate(tw);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(v => String(v).padStart(2, '0')).join(':');
}

function refreshTitleClock() {
  const tw = Date.now() + 8 * 3_600_000;
  $('titleClock').textContent = `${dateStr(tw)} ${timeStr(tw)}`;
}

function refreshTop() {
  const e = eng!;
  const rate = currentRate();
  $('date').textContent = dateStr(gameTw);
  const year = Math.floor(e.s.day / 365.25) + 1;
  const status = e.blocking() || openUid !== null ? '<b>等待你的決定</b>' : userPaused ? '<b>暫停中</b>' : '';
  $('time').innerHTML = phase === 'intro' ? '&nbsp;' : rate < 3600 * 6
    ? `${timeStr(gameTw)} 台北時間 ${status}`
    : `第 ${year} 年 · ${SPEEDS[speed]} 天/秒 · 成果 <b class="gs">${e.score()}</b> ${status}`;
  ($('progress').firstElementChild as HTMLElement).style.width = `${(e.s.day / e.s.endDay) * 100}%`;
  $('divine').innerHTML = `${HAND_ICON}<span>${e.s.divine}</span><small style="opacity:.6">/${DIVINE_MAX}</small>`;
  document.querySelectorAll<HTMLButtonElement>('#speed button').forEach(b => {
    const v = Number(b.dataset.speed);
    b.classList.toggle('on', v === 0 ? userPaused : !userPaused && v === speed);
  });
  if (phase === 'intro') {
    const acc = $('accel');
    acc.hidden = false;
    const d = new Date(gameTw);
    const flash = introFlash();
    acc.innerHTML = `<div class="big">${d.getUTCFullYear()}<small>年</small>${String(d.getUTCMonth() + 1).padStart(2, '0')}<small>月</small>${String(d.getUTCDate()).padStart(2, '0')}<small>日</small></div>`
      + (flash ? `<div class="flash">${esc(flash)}</div>` : '');
  }
}

// ---------- 數值面板 ----------
const statEls = new Map<StatKey, { root: HTMLElement; val: HTMLElement; tr: HTMLElement; fill: HTMLElement; mark?: HTMLElement }>();
function buildStats() {
  const root = $('stats');
  root.innerHTML = '';
  shownVals = {};
  for (const k of STAT_ORDER) {
    const m = STAT_META[k];
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = `<div class="stat-head"><span class="name">${m.label}</span><span class="val"></span><span class="tr"></span></div>
      <div class="bar ${m.lean ? 'lean' : ''}"><div class="fill"></div>${m.lean ? '<div class="mark"></div>' : ''}</div>
      <div class="ends"><span>${m.lo}</span>${m.lean ? '<span>現狀</span>' : ''}<span>${m.hi}</span></div>`;
    root.appendChild(div);
    statEls.set(k, {
      root: div, val: div.querySelector('.val')!, tr: div.querySelector('.tr')!,
      fill: div.querySelector('.fill')!, mark: div.querySelector('.mark') ?? undefined,
    });
  }
  const w = document.createElement('div');
  w.id = 'weather';
  root.appendChild(w);
}

/** 天候：玩家看不到數值、卻會推動局勢的背景因子 */
function weatherHtml(e: Engine) {
  const h = e.s.hidden;
  const tri = (v: number, lo: string, mid: string, hi: string) => (v > 0.25 ? hi : v < -0.25 ? lo : mid);
  const arrow = (v: number) => (v > 0.25 ? '▲' : v < -0.25 ? '▼' : '－');
  const items: [string, string, string, string][] = [
    ['全球景氣', arrow(h.econ), tri(h.econ, '低迷', '持平', '繁榮'), h.econ < -0.25 ? 'n' : h.econ > 0.25 ? 'p' : ''],
    ['對岸態度', arrow(h.stance), tri(h.stance, '和緩', '平穩', '強硬'), h.stance > 0.25 ? 'n' : h.stance < -0.25 ? 'p' : ''],
    ['世代認同', h.identity > 0.25 ? '→' : h.identity < -0.25 ? '←' : '－', tri(h.identity, '趨向統一', '穩定', '趨向獨立'), 'l'],
    ['社會氛圍', arrow(h.mood), tri(h.mood, '低迷', '平常', '樂觀'), h.mood < -0.25 ? 'n' : h.mood > 0.25 ? 'p' : ''],
    ['經濟依賴', h.dep >= 60 ? '▲' : h.dep <= 35 ? '▼' : '－', h.dep >= 60 ? '偏高' : h.dep <= 35 ? '分散' : '中等', h.dep >= 60 ? 'n' : ''],
  ];
  return `<div class="w-title">天候<small>看不見、但推動局勢的背景因子</small></div><div class="w-grid">${items.map(([k, a, t, c]) =>
    `<div class="w ${c}"><span>${k}</span><b>${a} ${t}</b></div>`).join('')}</div>`;
}

function isDanger(k: StatKey, v: number) {
  const d = STAT_META[k].danger;
  return (d === 'low' && v < 22) || (d === 'high' && v > 80);
}

let wasDanger = false;
function refreshStats() {
  if (statsHold) return;
  const e = eng!, st = e.s.stats;
  const h = e.s.history;
  const ref = h.length >= 3 ? h[h.length - 3].s : h[0].s;
  let anyDanger = false;
  for (const [i, k] of STAT_ORDER.entries()) {
    const v = st[k], el = statEls.get(k)!, m = STAT_META[k];
    if (m.lean) {
      el.val.textContent = `${describeLean(v)} ${v > 0 ? '+' : ''}${Math.round(v)}`;
      const left = Math.min(50, 50 + v / 2), w = Math.abs(v / 2);
      el.fill.style.left = `${left}%`; el.fill.style.width = `${w}%`;
      el.fill.style.background = v < 0 ? LEAN_NEG : LEAN_POS;
      el.mark!.style.left = `${50 + v / 2}%`;
    } else {
      el.val.textContent = `${Math.round(v)}`;
      el.fill.style.width = `${v}%`;
      el.fill.style.background = isDanger(k, v) ? 'var(--danger)' : k === 'tension' ? `hsl(${120 - v * 1.2}, 70%, 60%)` : 'var(--accent)';
    }
    const prev = shownVals[k];
    if (prev !== undefined && Math.abs(v - prev) >= 0.6) flashStat(k, v - prev);
    shownVals[k] = v;
    const diff = v - ref[i];
    el.tr.textContent = diff > 1 ? '▲' : diff < -1 ? '▼' : '';
    el.tr.className = `tr ${diff > 1 ? 'up' : diff < -1 ? 'down' : ''}`;
    const dg = isDanger(k, v);
    anyDanger ||= dg;
    el.root.classList.toggle('danger', dg);
  }
  if (anyDanger && !wasDanger) sfx.play('warn');
  wasDanger = anyDanger;
  const w = document.getElementById('weather');
  if (w) w.innerHTML = weatherHtml(e);

  const mini: StatKey[] = ['stability', 'wealth', 'gdp', 'tension', 'govLean', 'popLean', 'intl', 'trust'];
  $('mini').innerHTML = mini.map(k => {
    const v = st[k], m = STAT_META[k];
    const txt = m.lean ? `${v > 0 ? '+' : ''}${Math.round(v)}` : Math.round(v);
    return `<span class="mchip ${isDanger(k, v) ? 'danger' : ''}">${m.short}<b>${txt}</b></span>`;
  }).join('');
}

/** 數值條依變化量短暫變色：好轉綠、惡化紅（統獨依方向用紫／琥珀），變化越大越亮越久，並浮出 ±值 */
function flashStat(k: StatKey, d: number) {
  const el = statEls.get(k);
  if (!el) return;
  const m = STAT_META[k];
  const color = m.lean ? (d < 0 ? LEAN_NEG : LEAN_POS)
    : (m.danger === 'high' ? d < 0 : d > 0) ? '#5ee59a' : '#ff5a6a';
  const mag = Math.min(1, Math.abs(d) / 6);
  const dur = 700 + mag * 1100;
  const bar = el.fill.parentElement!;
  bar.animate([
    { boxShadow: `0 0 0 1px ${color}, 0 0 ${6 + mag * 14}px ${color}` },
    { boxShadow: `0 0 0 1px ${color}, 0 0 ${6 + mag * 14}px ${color}`, offset: 0.4 },
    { boxShadow: '0 0 0 0 transparent' },
  ], { duration: dur, easing: 'ease-out' });
  const base = getComputedStyle(el.fill).backgroundColor;
  el.fill.animate([{ background: color }, { background: color, offset: 0.4 }, { background: base }], { duration: dur, easing: 'ease-out' });
  if (Math.abs(d) >= 1 && !reducedMotion()) {
    const f = document.createElement('span');
    f.className = 'delta-float';
    f.style.color = color;
    f.textContent = `${d > 0 ? '+' : ''}${Math.round(d)}`;
    el.root.querySelector('.stat-head')!.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }
}

// ---------- 圖層 ----------
function buildLayers() {
  const root = $('layers');
  root.innerHTML = `<div class="layer-title">地圖圖層</div><div class="layer-btns">${LAYERS.map(l =>
    `<button data-layer="${l.key}" class="${l.key === layer ? 'on' : ''}">${l.label}</button>`).join('')}</div><div class="legend"></div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach(b => b.onclick = () => {
    sfx.play('click');
    layer = b.dataset.layer as LayerKey;
    buildLayers();
    refreshLayer();
  });
  const l = LAYERS.find(x => x.key === layer)!;
  root.querySelector('.legend')!.innerHTML = l.key === 'terrain'
    ? '依真實山脈走勢呈現的地形（垂直放大 5 倍）'
    : `<div class="grad" style="background:linear-gradient(90deg,${l.colors.join(',')})"></div><div class="row"><span>${l.lo}</span><span>${l.hi}</span></div>`;
  syncLayersHeight();
}

/** 圖層面板貼齊左下角，數值面板的高度依它實際高度讓位（面板隱藏時高度為 0，不更新） */
function syncLayersHeight() {
  const h = $('layers').offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--layers-h', `${h}px`);
}
new ResizeObserver(syncLayersHeight).observe(document.getElementById('layers')!);

function refreshLayer() {
  map.setMode(layer === 'terrain' ? 'terrain' : 'layer');
  if (layer === 'terrain' || !eng) return;
  const l = LAYERS.find(x => x.key === layer)!;
  map.setCountyColors(eng.s.counties.map(c => {
    const v = c[layer as 'popLean' | 'stability' | 'wealth'];
    return ramp(l.colors, layer === 'popLean' ? (v + 100) / 200 : v / 100);
  }));
}

// ---------- 事件列表 ----------
function deltaChips(d?: Partial<Record<StatKey, number>>) {
  if (!d) return '';
  // 與選項預覽一致：上升在前、統獨方向居中、下降在後
  const rank = (k: string, v: number) => (STAT_META[k as StatKey].lean ? 0 : v > 0 ? 1 : -1);
  return Object.entries(d).sort(([ka, va], [kb, vb]) => rank(kb, vb!) - rank(ka, va!)).map(([k, v]) => {
    const m = STAT_META[k as StatKey];
    const good = m.lean ? 'l' : (m.danger === 'high' ? v! < 0 : v! > 0) ? 'p' : 'n';
    return `<span class="chip-d ${good}">${m.short}${v! > 0 ? '+' : ''}${v}</span>`;
  }).join('');
}

function refreshFeed() {
  const e = eng!;
  const pend = [...e.s.pending].sort((a, b) => (a.tier === 'major' ? -1 : 0) - (b.tier === 'major' ? -1 : 0));
  const general = pend.filter(p => p.tier !== 'major').length;
  $('pendingList').innerHTML = pend.length ? `<p class="queue">事件不會倒數，慢慢想。待決 ${general}/${MAX_PENDING}，再多一件時最舊的交給自然命運。</p>` + pend.map(p => {
    const d = e.defs.get(p.eventId)!, c = CAT_META[d.cat];
    const waited = e.s.day - p.createdDay;
    return `<div class="ev pend ${p.tier === 'major' ? 'major' : ''}" data-uid="${p.uid}" style="--c:${c.color}"><span class="ic">${iconSvg(d.cat)}</span>
      <div class="body"><div class="t">${p.tier === 'major' ? '<span class="tag-major">重大</span>' : ''}${esc(e.text(d.title, p))}</div>
      <div class="m">${c.label} · ${esc(e.placeName(p))} · ${waited ? `已等待 ${waited} 天` : '剛發生'}</div></div></div>`;
  }).join('') : '<p class="empty">目前沒有待決事件</p>';
  $('pendingList').querySelectorAll<HTMLElement>('[data-uid]').forEach(el => el.onclick = () => openModal(Number(el.dataset.uid)));
  const badge = $('badge');
  badge.hidden = !pend.length;
  badge.textContent = String(pend.length);
}

function refreshLog() {
  const e = eng!;
  const items = e.s.log.filter(l => l.tier !== 'news').slice(-30).reverse();
  $('logList').innerHTML = items.map(l => {
    const c = CAT_META[l.cat];
    return `<div class="ev" style="--c:${c.color}"><span class="ic">${iconSvg(l.cat)}</span><div class="body">
      <div class="t">${esc(l.title)}${l.intervened ? '<span class="tag-int">✋干預</span>' : ''}</div>
      <div class="m">${shortDate(l.day)} · ${esc(l.place)} · ${esc(l.optionText ?? '')}</div>
      <div>${deltaChips(l.deltas)}</div></div></div>`;
  }).join('');
}

let hudTick = 0;
function refreshHud() {
  if (!eng) return;
  refreshTop();
  refreshStats();
  if (++hudTick % 4 === 0) { refreshFeed(); refreshLayer(); if (selCounty !== null) showCounty(selCounty); }
}

// ---------- 歷史上的今天 ----------
const HISTORY_EVERY = 7; // 每則顯示秒數
let histAcc = HISTORY_EVERY;
let histDate: [number, number] = [1, 1];
let histPos = 0;
const mmdd = (m: number, d: number) => `${m}月${String(d).padStart(2, '0')}日`;

function gameMonthDay(): [number, number] {
  const d = new Date(gameTw);
  return [d.getUTCMonth() + 1, d.getUTCDate()];
}

/** 依當下遊戲日期輪播一則史事；高速時只會取樣當下那一天 */
function nextHistory() {
  const [m, d] = gameMonthDay();
  if (m !== histDate[0] || d !== histDate[1]) { histDate = [m, d]; histPos = Math.floor(Math.random() * 8); }
  const list = entriesOnSync(m, d);
  if (list === null) { histAcc = HISTORY_EVERY - 0.3; return; } // 該月資料載入中，稍後再試
  histAcc = 0;
  const el = $('historyText');
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  if (!list.length) { el.innerHTML = `<span class="y">${mmdd(m, d)}</span>點擊查看鄰近日期的台灣史事`; return; }
  const e = list[histPos++ % list.length];
  el.innerHTML = `<span class="y">${e.y}・${mmdd(m, d)}</span><span class="k">${KIND_LABEL[e.k]}</span>${esc(e.t)}`;
}

let histFilter: HistoryKind | 'all' = 'all';
async function openHistory(m: number, d: number) {
  sfx.play('click');
  historyOpen = true;
  const card = $('historyDlg').querySelector('.card') as HTMLElement;
  const list = await entriesOn(m, d);
  const shown = list.filter(e => histFilter === 'all' || e.k === histFilter);
  const filters: [HistoryKind | 'all', string][] = [['all', '全部'], ['event', KIND_LABEL.event], ['birth', KIND_LABEL.birth], ['other', KIND_LABEL.other]];
  card.innerHTML = `
    <div class="hist-head">
      <button id="hPrev" aria-label="前一天">‹</button>
      <div class="ttl"><small>歷史上的今天</small><b>${mmdd(m, d)}</b></div>
      <button id="hNext" aria-label="後一天">›</button>
    </div>
    <div class="hist-filter">${filters.map(([k, label]) => `<button data-k="${k}" class="${histFilter === k ? 'on' : ''}">${label}</button>`).join('')}</div>
    <div class="hist-list">${shown.length ? shown.map(e => `
      <div class="hist-item"><div class="yr">${e.y}<small>${eng ? `${new Date(gameTw).getUTCFullYear() - e.y} 年前` : ''}</small></div>
      <div><div class="t"><span class="pill ${e.k}">${KIND_LABEL[e.k]}</span>${esc(e.t)}</div><div class="d">${esc(e.d)}</div></div></div>`).join('')
      : '<p class="empty">這一天目前沒有收錄的史事。</p>'}</div>
    <div class="hist-foot"><span class="note">資料整理自公開史料，如有錯誤歡迎回報。閱讀時遊戲暫停。</span><button class="btn primary" id="hClose">關閉</button></div>`;
  $('historyDlg').hidden = false;
  const shift = (delta: number) => {
    const t = new Date(Date.UTC(2024, m - 1, d + delta)); // 2024 為閏年，可走到 2 月 29 日
    void openHistory(t.getUTCMonth() + 1, t.getUTCDate());
  };
  $('hPrev').onclick = () => shift(-1);
  $('hNext').onclick = () => shift(1);
  card.querySelectorAll<HTMLButtonElement>('.hist-filter button').forEach(b => b.onclick = () => {
    histFilter = b.dataset.k as HistoryKind | 'all';
    void openHistory(m, d);
  });
  $('hClose').onclick = closeHistory;
}

function closeHistory() {
  sfx.play('click');
  $('historyDlg').hidden = true;
  historyOpen = false;
}

// ---------- 快訊、提示 ----------
const tickerQueue: LogEntry[] = [];
let tickerBusy = false;
function pushTicker(l: LogEntry) {
  tickerQueue.push(l);
  if (tickerQueue.length > 4) tickerQueue.shift();
  if (!tickerBusy) nextTicker();
}
function nextTicker() {
  const l = tickerQueue.shift();
  if (!l) { tickerBusy = false; return; }
  tickerBusy = true;
  const el = $('tickerText');
  el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  el.innerHTML = `<span class="d">${shortDate(l.day)}</span>${esc(l.title)}${l.place ? `（${esc(l.place)}）` : ''} ${deltaChips(l.deltas)}`;
  el.title = l.desc ?? '';
  setTimeout(nextTicker, 3200);
}

function toast(html: string, color: string, ms = 4200) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast'; el.style.setProperty('--c', color); el.innerHTML = html;
  box.prepend(el);
  while (box.children.length > (isMobile() ? 1 : 3)) box.lastElementChild!.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, ms);
}

// ---------- 泡泡 ----------
function addBubble(p: Pending) {
  const d = eng!.defs.get(p.eventId)!;
  const el = document.createElement('button');
  el.className = `bubble ${p.tier === 'major' ? 'major' : ''} ${d.egg ? 'egg' : ''} ${d.egg?.fx === 'fade' ? 'ghost' : ''}`;
  el.style.setProperty('--c', CAT_META[d.cat].color);
  el.innerHTML = iconSvg(d.cat, p.tier === 'major' ? 22 : 18);
  el.title = eng!.text(d.title, p);
  el.onclick = ev => { ev.stopPropagation(); openModal(p.uid); };
  labelLayer.appendChild(el);
  bubbles.set(p.uid, el);
}
function removeBubble(uid: number) {
  bubbles.get(uid)?.remove();
  bubbles.delete(uid);
}

// ---------- 引擎掛勾 ----------
function attachHooks(e: Engine) {
  e.hooks = {
    news: l => {
      pushTicker(l);
      const { x, y } = locXY(l.county, l.point);
      map.ripple(x, y, catColor(l.cat), 14, 3);
      sfx.play('news');
    },
    pending: p => {
      const d = e.defs.get(p.eventId)!;
      addBubble(p);
      const { x, y } = locXY(p.county, p.point);
      map.ripple(x, y, catColor(d.cat), 26, 5);
      map.highlight(p.county, catColor(d.cat), 4);
      if (d.egg) { eggFx(d, p); refreshFeed(); return; }
      sfx.play(d.cat);
      const idle = performance.now() - lastInteract > 6000;
      // 4 倍速時一般事件太密集，只在 1、2 倍速自動移動鏡頭
      if (settings.cam === 'all' && idle && openUid === null && speed < 3 && !reducedMotion()) {
        map.flyTo(x, y, isMobile() ? 360 : 300, 1.6, 0.7);
      }
      refreshFeed();
    },
    major: p => {
      const d = e.defs.get(p.eventId)!;
      const { x, y, zoom } = locXY(p.county, p.point);
      map.ripple(x, y, catColor(d.cat), p.county !== null ? 34 : 80, 8);
      map.highlight(p.county, catColor(d.cat), 8);
      sfx.play('major');
      if (d.egg) eggFx(d, p, false); else setTimeout(() => sfx.play(d.cat), 400);
      if (settings.cam !== 'off') map.flyTo(x, y, zoom * (isMobile() ? 1.35 : 1), 1.3, 0.85);
      // 若已有對話框開著，關閉時會自動接著打開這一件
      setTimeout(() => {
        if (e === eng && openUid === null && !historyOpen && !reviewOpen && e.s.pending.some(q => q.uid === p.uid)) openModal(p.uid);
      }, settings.cam === 'off' ? 300 : 1300);
    },
    resolved: (l, p) => {
      removeBubble(p.uid);
      const rd = e.defs.get(l.eventId);
      if (rd?.egg) {
        const fresh = recordEgg(l.eventId, l.option, e.s.code, parents(), true);
        if (fresh && !rd.chainOnly) setTimeout(() => toast(`<div class="t">✦ 彩蛋圖鑑解鎖：${esc(l.title)}</div><div>標題畫面的「彩蛋圖鑑」可以回味</div>`, '#ffd36b', 5200), 600);
      }
      if (openUid !== p.uid) {
        toast(`<div class="t">${esc(l.title)}・${esc(l.optionText ?? '')}</div><div>${esc(l.result ?? '')}</div>${deltaChips(l.deltas)}`, CAT_META[l.cat].color);
      }
      refreshLog(); refreshFeed();
    },
    ended: end => setTimeout(() => showEnding(end), 1200),
    achieved: m => {
      sfx.play('divine');
      toast(`<div class="t">🏅 里程碑：${esc(m.title)}</div><div>${esc(m.desc)}</div>`, '#ffd36b', 5200);
    },
    divine: () => { const el = $('divine'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); },
  };
}

// ---------- 事件對話框 ----------
function openModal(uid: number) {
  const e = eng!;
  const p = e.s.pending.find(x => x.uid === uid);
  if (!p) return;
  const d = e.defs.get(p.eventId)!;
  const c = CAT_META[d.cat];
  openUid = uid;
  sfx.play('click');
  const probs = e.probs(d);
  const costs = d.options!.map((_, i) => e.cost(d, i));
  const card = $('modal').querySelector('.card') as HTMLElement;
  card.style.setProperty('--c', c.color);
  card.classList.toggle('egg', !!d.egg);
  const isMajor = p.tier === 'major';
  // 彩蛋優先用自己的插圖（後續事件沿用母事件），沒有圖時退回分類插圖
  const eggArt = d.egg ? `url('${BASE}assets/eggs/${parents().get(d.id) ?? d.id}.webp'), ` : '';
  card.innerHTML = `
    <div class="ev-hero" style="background-image:${eggArt}radial-gradient(120% 140% at 20% 0%, ${c.color}, transparent 60%), url('${BASE}assets/events/${d.cat}.webp')"><span class="ic">${d.egg ? '✦' : iconSvg(d.cat, 40)}</span></div>
    <div class="ev-head">
      <div class="ev-kind">${d.egg ? `<span class="pill egg-pill">✦ 稀有事件 ${'★'.repeat(d.egg.stars)}</span>` : ''}<span class="pill">${c.label}</span><span>${isMajor ? '重大事件' : '事件'} · ${esc(e.placeName(p))} · ${shortDate(e.s.day)}</span></div>
      <div class="ev-title">${esc(e.text(d.title, p))}</div>
    </div>
    <div class="ev-desc">${esc(e.text(d.desc, p))}</div>
    <div class="opts">${d.options!.map((o, i) => `
      <button class="opt" data-i="${i}" ${e.s.divine < costs[i] ? 'disabled' : ''}>
        <div class="p" style="width:${probs[i] * 100}%"></div>
        <div class="row"><span class="tx">${esc(o.text)}</span><span class="pr">自然命運 ${Math.round(probs[i] * 100)}%</span>
        <span class="cost">${HAND_ICON}${costs[i]}</span></div>
        <div class="pvs">${optionPreview(o)}</div>
      </button>`).join('')}</div>
    <div class="ev-foot">
      <span class="note">點選項＝以命運干預 ｜ 目前命運 ${e.s.divine}${isMajor ? ' ｜ 順其自然 +1 命運' : ' ｜ 不會倒數，可以慢慢想'}<br>▲▼ 為影響方向與幅度，虛線框為長期影響</span>
      ${isMajor ? '' : '<button class="btn" id="mLater">稍後</button>'}
      <button class="btn fate" id="mFate">順其自然</button>
    </div>`;
  $('modal').hidden = false;
  card.querySelectorAll<HTMLButtonElement>('.opt').forEach(b => b.onclick = () => choose(uid, Number(b.dataset.i)));
  $('mFate').onclick = () => choose(uid, null);
  const later = document.getElementById('mLater');
  if (later) later.onclick = () => closeModal();
  card.querySelector<HTMLButtonElement>('.opt:not(:disabled)')?.focus({ preventScroll: true });
}

function closeModal(returnCam = false) {
  $('modal').hidden = true;
  openUid = null;
  // 同一天若還有重大事件在等待，接著打開
  const next = eng?.blocking();
  if (next) { setTimeout(() => { if (openUid === null) openModal(next.uid); }, 350); return; }
  if (returnCam && settings.cam !== 'off') map.overview(true);
}

function choose(uid: number, i: number | null) {
  const e = eng!;
  const card = $('modal').querySelector('.card') as HTMLElement;
  const p = e.s.pending.find(x => x.uid === uid);
  if (!p) return closeModal();
  const isMajor = p.tier === 'major';
  const def = e.defs.get(p.eventId)!;
  const cost = i !== null ? e.cost(def, i) : 0;
  // 順其自然：左側數值等骰子停下才變動
  if (i === null) statsHold = true;
  const res = e.resolve(uid, i);
  if (!res) { statsHold = false; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); return; }
  if (res.intervened) interveneFx(card, i!, cost, p);
  card.querySelectorAll<HTMLButtonElement>('.opt, .btn').forEach(b => b.disabled = true);
  const opts = [...card.querySelectorAll<HTMLElement>('.opt')];
  const finish = () => {
    opts[res.option]?.classList.add('picked');
    statsHold = false;
    if (!res.intervened) sfx.play('resolve');
    const foot = card.querySelector('.ev-foot')!;
    const opt = e.defs.get(p.eventId)!.options![res.option];
    const lasting = lastingNote(opt, d => (d >= 365 ? `約 ${Math.round(d / 365)} 年` : `${d} 天`));
    foot.insertAdjacentHTML('beforebegin', `<div class="result"><b>${res.intervened ? '✋ 你出手了：' : '自然命運：'}${esc(res.optionText ?? '')}</b><br>${esc(res.result ?? '')}<div>${deltaChips(res.deltas)}</div>${lasting ? `<div class="lasting">⏳ ${esc(lasting)}</div>` : ''}</div>`);
    foot.innerHTML = `<span class="note"></span><button class="btn primary" id="mOk">繼續</button>`;
    $('mOk').onclick = () => { sfx.play('click'); closeModal(isMajor); };
    refreshHud();
  };
  if (i === null) {
    // 擲骰動畫：在選項間跳動後停在自然命運的結果
    let step = 0;
    const total = 10 + opts.length + res.option;
    const spin = () => {
      opts.forEach((o, j) => o.classList.toggle('roll', j === step % opts.length));
      sfx.play('click');
      if (++step <= total - (total % opts.length) + res.option && step < 40) setTimeout(spin, 50 + step * 9);
      else { opts.forEach(o => o.classList.remove('roll')); finish(); }
    };
    spin();
  } else finish();
}

/** 出手干預的特效：金色光爆、光點四散、命運飛向計數器、地圖金色漣漪 */
function interveneFx(card: HTMLElement, i: number, cost: number, p: Pending) {
  sfx.play('intervene');
  const opt = card.querySelectorAll<HTMLElement>('.opt')[i];
  const cr = card.getBoundingClientRect(), or = opt.getBoundingClientRect();
  const cx = or.left + or.width / 2, cy = or.top + or.height / 2;
  card.style.setProperty('--bx', `${cx - cr.left}px`);
  card.style.setProperty('--by', `${cy - cr.top + card.scrollTop}px`);
  card.classList.remove('divine-burst'); void card.offsetWidth; card.classList.add('divine-burst');
  opt.classList.add('chosen');

  const gold = new THREE.Color('#ffd36b');
  const { x, y } = locXY(p.county, p.point);
  map.ripple(x, y, gold, p.county !== null ? 55 : 110, 6);
  map.highlight(p.county, gold, 5);
  const dv = $('divine');
  dv.classList.remove('bump'); void dv.offsetWidth; dv.classList.add('bump');
  if (reducedMotion()) return;

  // 光點從選項向外散開
  for (let k = 0; k < 22; k++) {
    const sp = document.createElement('span');
    sp.className = 'spark';
    sp.style.left = `${cx}px`; sp.style.top = `${cy}px`;
    document.body.appendChild(sp);
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 140;
    sp.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.2)`, opacity: 0 },
    ], { duration: 600 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => sp.remove();
  }
  // 花費的命運從選項飛向頂列計數器
  const costEl = opt.querySelector<HTMLElement>('.cost')!.getBoundingClientRect();
  const dr = dv.getBoundingClientRect();
  const fly = document.createElement('span');
  fly.className = 'cost-fly';
  fly.innerHTML = `${HAND_ICON}−${cost}`;
  fly.style.left = `${costEl.left}px`; fly.style.top = `${costEl.top}px`;
  document.body.appendChild(fly);
  fly.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: 'translate(0, -16px) scale(1.25)', opacity: 1, offset: 0.25 },
    { transform: `translate(${dr.left - costEl.left}px, ${dr.top - costEl.top}px) scale(0.7)`, opacity: 0 },
  ], { duration: 950, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => fly.remove();
}

// ---------- 五年回顧 ----------
function openReview() {
  const e = eng!;
  e.s.reviews = Math.floor(e.s.day / REVIEW_DAYS);
  reviewOpen = true;
  sfx.play('politics');
  const from = Math.max(0, e.s.day - REVIEW_DAYS);
  const h = e.s.history;
  const then = [...h].reverse().find(x => x.day <= from) ?? h[0];
  const events = e.s.log.filter(l => l.day > from && l.tier !== 'news');
  const majors = events.filter(l => l.tier === 'major').slice(-4);
  const acted = events.filter(l => l.intervened).length;
  const card = $('reviewDlg').querySelector('.card') as HTMLElement;
  card.innerHTML = `
    <div class="end-kicker">第 ${e.s.reviews * 5} 年回顧・${shortDate(from)} → ${shortDate(e.s.day)}</div>
    <h2>五年過去了</h2>
    <div class="rv-grid">${STAT_ORDER.map((k, i) => {
      const a = then.s[i], b = e.s.stats[k], d = b - a, m = STAT_META[k];
      const good = m.lean ? 'l' : (m.danger === 'high' ? d < 0 : d > 0) ? 'p' : 'n';
      const fmtV = (v: number) => (m.lean ? `${v > 0 ? '+' : ''}${Math.round(v)}` : String(Math.round(v)));
      return `<div><span>${m.label}</span><b>${fmtV(a)} → ${fmtV(b)}</b>${Math.abs(d) >= 1 ? `<i class="${good}">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}</i>` : ''}</div>`;
    }).join('')}</div>
    <p class="rv-line">這五年發生 ${events.length} 件事件，你出手干預了 <b>${acted}</b> 次，成果指數目前 <b>${e.score()}</b>。</p>
    ${majors.length ? `<div class="rv-major"><div class="w-title">這五年的重大事件</div>${majors.map(l =>
      `<div>${shortDate(l.day)}・${esc(l.title)}・<span>${esc(l.optionText ?? '')}</span>${l.intervened ? '<span class="tag-int">✋</span>' : ''}</div>`).join('')}</div>` : ''}
    <div class="menu-btns"><button class="btn primary" id="rvOk">繼續前進</button></div>`;
  $('reviewDlg').hidden = false;
  $('rvOk').onclick = closeReview;
}

function closeReview() {
  sfx.play('click');
  $('reviewDlg').hidden = true;
  reviewOpen = false;
  save();
}

// ---------- 彩蛋 ----------
let parentMap: Map<string, string> | null = null;
/** 後續事件 → 母事件 */
function parents() { return parentMap ??= eggParents(eng?.defs.values() ?? []); }

/** 本局遇到的彩蛋（不含後續事件，依發生順序） */
function eggsThisGame(e: Engine): EventDef[] {
  return e.s.eggs.map(id => e.defs.get(id)!).filter(d => d && !d.chainOnly);
}

/** 特定彩蛋的地標位置（經緯度） */
const EGG_SPOTS: Record<string, [number, number]> = {
  egg_yushan_snow: [120.957, 23.47],   // 玉山
  egg_sunmoon_pink: [120.916, 23.866], // 日月潭
  egg_101_message: [121.5645, 25.034], // 台北 101
};

/** 彩蛋發生時的音效與地圖特效；camera=false 時不移動鏡頭（重大事件由呼叫端處理） */
function eggFx(d: EventDef, p: Pending, camera = true) {
  const egg = d.egg!;
  sfx.play('egg_chime');
  const voice = egg.sfx;
  if (voice && voice !== 'chime') setTimeout(() => sfx.play(`egg_${voice}`), 500);
  let { x, y, zoom } = locXY(p.county, p.point);
  const spot = EGG_SPOTS[parents().get(d.id) ?? d.id];
  if (spot) [x, y] = lonLatToKm(spot[0], spot[1]);
  const gold = new THREE.Color('#ffd36b');
  map.ripple(x, y, gold, 40, 6);
  const fx = map.fx;
  switch (egg.fx) {
    case 'stars': fx.stars(x, y); break;
    case 'meteor': fx.meteor(x, y); break;
    case 'snow': fx.snow(x, y); fx.halo(x, y, '#ffffff'); break;
    case 'halo': fx.halo(x, y); break;
    case 'whales': fx.whales(x, y); break;
    case 'footprints': fx.footprints(x + 38, y - 14, x, y); break;
    case 'mirage': fx.mirage(x, y); break;
    case 'pink': fx.halo(x, y, '#ff8fc8'); map.highlight(p.county, new THREE.Color('#ff8fc8'), 9); map.ripple(x, y, new THREE.Color('#ff8fc8'), 30, 7); break;
    case 'heart': fx.heart(x + 150, y); break;
    case 'beam': fx.beam(x, y); break;
    case 'dream': dreamOverlay(); fx.stars(x, y); break;
    case 'fade': fx.sparkle(x, y, '#cfe8ff'); break;
    default: fx.sparkle(x, y);
  }
  // 彩蛋值得一看：除非關閉事件鏡頭，否則移過去
  if (camera && settings.cam !== 'off' && openUid === null) {
    const far = egg.fx === 'mirage' || egg.fx === 'heart' || egg.fx === 'stars' || egg.fx === 'meteor';
    map.flyTo(egg.fx === 'heart' ? x + 150 : x, y, far ? Math.max(zoom, 520) : (isMobile() ? 300 : 240), 1.6, far ? 0.95 : 0.8);
  }
}

/** 全島同一個夢：畫面暗下、柔光暈染幾秒 */
function dreamOverlay() {
  if (reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'dream-fx';
  document.body.appendChild(el);
  el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 7000, easing: 'ease-in-out' })
    .onfinish = () => el.remove();
}

function openDex() {
  sfx.unlock();
  sfx.play('click');
  showDexList();
  $('dexDlg').hidden = false;
}
function showDexList(scrollTo?: string) {
  const card = $('dexDlg').querySelector('.card') as HTMLElement;
  card.innerHTML = dexHtml(ALL_EVENTS, BASE);
  $('dexClose').onclick = closeDex;
  card.querySelectorAll<HTMLElement>('.dex-card[data-id]').forEach(el => el.onclick = () => showDexDetail(el.dataset.id!));
  // 從詳細頁返回時捲回原本那張卡片
  if (scrollTo) card.querySelector<HTMLElement>(`[data-id="${scrollTo}"]`)?.scrollIntoView({ block: 'center' });
  else card.scrollTop = 0;
}
function showDexDetail(id: string) {
  sfx.play('click');
  const card = $('dexDlg').querySelector('.card') as HTMLElement;
  card.innerHTML = dexDetailHtml(id, ALL_EVENTS, BASE);
  card.scrollTop = 0;
  const back = () => { sfx.play('click'); showDexList(id); };
  $('dexBack').onclick = back;
  $('dexBack2').onclick = back;
}
function closeDex() {
  sfx.play('click');
  $('dexDlg').hidden = true;
}
function refreshDexButton() {
  const { got, total } = dexProgress(ALL_EVENTS);
  $('btnDex').textContent = `彩蛋圖鑑 ${got} / ${total}`;
}

// ---------- 縣市卡 ----------
function showCounty(i: number | null) {
  selCounty = i;
  map.setSelected(i);
  const card = $('countyCard');
  if (i === null || !eng) { card.hidden = true; return; }
  const c = eng.s.counties[i];
  const bar = (label: string, v: number, lean = false) => lean
    ? `<div class="stat"><div class="stat-head"><span class="name">${label}</span><span class="val">${describeLean(v)} ${v > 0 ? '+' : ''}${Math.round(v)}</span></div>
       <div class="bar lean"><div class="fill" style="left:${Math.min(50, 50 + v / 2)}%;width:${Math.abs(v / 2)}%;background:${v < 0 ? LEAN_NEG : LEAN_POS}"></div><div class="mark" style="left:${50 + v / 2}%"></div></div></div>`
    : `<div class="stat"><div class="stat-head"><span class="name">${label}</span><span class="val">${Math.round(v)}</span></div><div class="bar"><div class="fill" style="width:${v}%"></div></div></div>`;
  const recent = eng.s.log.filter(l => l.county === i && l.tier !== 'news').slice(-3).reverse();
  card.innerHTML = `<button class="x" aria-label="關閉">✕</button><h4>${c.name}</h4><div class="sub">人口約 ${c.pop} 萬</div>
    ${bar('民眾傾向', c.popLean, true)}${bar('社會安穩', c.stability)}${bar('人民財富', c.wealth)}
    <div class="recent">${recent.length ? '近期：' + recent.map(l => `${shortDate(l.day)} ${esc(l.title)}`).join('、') : '近期無重大事件'}</div>`;
  card.hidden = false;
  card.querySelector<HTMLButtonElement>('.x')!.onclick = () => showCounty(null);
}

// ---------- 結局 ----------
function showEnding(end: Ending) {
  phase = 'ended';
  clearSave();
  sfx.play('ending');
  const e = eng!;
  const card = $('ending').querySelector('.card') as HTMLElement;
  const years = (end.day / 365.25).toFixed(1);
  const intervened = e.s.interventions;
  // 若不出手：同一個種子全程順其自然，量化玩家這一局造成的差別
  const base = Engine.baseline(ALL_EVENTS, COUNTIES, e.s, end.day);
  const ms = MILESTONE_LIST.filter(m => e.s.achieved.includes(m.id));
  const rank = addRecord({
    score: end.score, title: end.title, years: +years, seed: e.s.seed, code: e.s.code, survived: end.survived,
    at: new Date().toISOString(), milestones: ms.length,
  });
  const kicker = `${end.survived ? '尾聲' : '終局'}・${shortDate(end.day)}・第 ${years} 年`;
  const rec = buildEnding({
    s: e.s, end, baseline: base, kicker, milestones: ms.map(m => m.title),
    eggs: eggsThisGame(e).map(d => ({ title: d.title.replaceAll('{county}', ''), stars: d.egg!.stars })),
  });
  saveEnding(rec);
  card.innerHTML = `${endingShotHtml(rec, BASE)}
    <div class="menu-btns"><button class="btn primary" id="eShare">分享結果</button><button class="btn" id="eNew">再玩一局</button><button class="btn" id="eView">回到地圖</button></div>
    <details class="end-more"><summary>完整數據與走勢圖</summary>
      ${endingGridHtml(rec, rank ? `<div>本機紀錄<b>第 ${rank} 名</b></div>` : '')}
      <canvas id="endChart"></canvas>
      <div class="chart-keys"></div>
      <p class="chart-note">實線是你的這一局；虛線是遇上同樣事件、但你完全不出手時的走勢</p>
    </details>`;
  $('ending').classList.remove('archive');
  card.scrollTop = 0;
  $('ending').hidden = false;
  const shown = new Set<StatKey>(['govLean', 'popLean', 'stability', 'gdp', 'tension']);
  const palette = ['#9d6bd8', '#e2a93b', '#3fd0ff', '#ffd166', '#f28482', '#4fb0c6', '#ff4d5e', '#b8c0ff', '#90be6d', '#c77dff', '#f9c74f'];
  const keys = card.querySelector('.chart-keys')!;
  const draw = () => drawChart($('endChart') as HTMLCanvasElement, e.s, shown, palette, base.history);
  keys.innerHTML = STAT_ORDER.map((k, i) => `<button data-k="${k}" style="--k:${palette[i]}" class="${shown.has(k) ? '' : 'off'}">${STAT_META[k].label}</button>`).join('');
  keys.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
    const k = b.dataset.k as StatKey;
    if (shown.has(k)) shown.delete(k); else shown.add(k);
    b.classList.toggle('off');
    draw();
  });
  card.querySelector('.end-more')!.addEventListener('toggle', () => requestAnimationFrame(draw));
  $('eNew').onclick = () => { $('ending').hidden = true; newGame(); };
  $('eView').onclick = () => { $('ending').hidden = true; };
  $('eShare').onclick = async () => {
    sfx.play('click');
    const btn = $<HTMLButtonElement>('eShare');
    btn.disabled = true;
    try {
      const blob = await renderShareCard({
        title: end.title, kicker,
        text: end.text, score: end.score, baseline: base.score, years, interventions: intervened,
        milestones: ms.map(m => m.title), code: e.s.code ?? String(e.s.seed),
        stats: STAT_ORDER.map(k => ({ label: STAT_META[k].label, value: STAT_META[k].lean ? describeLean(e.s.stats[k]) : String(Math.round(e.s.stats[k])) })),
      }, `${BASE}assets/endings/${end.id}.webp`, `${BASE}assets/icon-192.png`);
      await shareOrDownload(blob, `命運之手-${end.title}-${end.score}.png`, `我在《命運之手：台灣》走過了 ${years} 年，結局「${end.title}」，成果指數 ${end.score}。${e.s.code ? `種子碼 ${e.s.code}，一起來挑戰同一個世界：${seedLink(e.s.code)}` : ''}`);
    } finally { btn.disabled = false; }
  };
}

function drawChart(cv: HTMLCanvasElement, s: GameState, shown: Set<StatKey>, palette: string[], baseline?: GameState['history']) {
  const dpr = Math.min(2, window.devicePixelRatio);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const maxDay = Math.max(1, s.history[s.history.length - 1].day);
  const X = (d: number) => pad.l + (d / maxDay) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / 100) * (h - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.fillStyle = '#8fa3b5'; ctx.font = '10px sans-serif';
  for (let v = 0; v <= 100; v += 25) { ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke(); }
  const startYear = new Date(s.startDayTw).getUTCFullYear();
  for (let y = 0; y <= maxDay / 365.25; y += 5) ctx.fillText(String(startYear + y), X(y * 365.25) - 12, h - 6);
  const line = (hist: GameState['history'], i: number, lean: boolean) => {
    ctx.beginPath();
    hist.forEach((p, j) => {
      if (p.day > maxDay) return;
      const v = lean ? (p.s[i] + 100) / 2 : p.s[i];
      if (j) ctx.lineTo(X(p.day), Y(v)); else ctx.moveTo(X(p.day), Y(v));
    });
    ctx.stroke();
  };
  STAT_ORDER.forEach((k, i) => {
    if (!shown.has(k)) return;
    const lean = !!STAT_META[k].lean;
    ctx.strokeStyle = palette[i];
    if (baseline) { ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55; ctx.setLineDash([5, 4]); line(baseline, i, lean); }
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = 1.8;
    line(s.history, i, lean);
  });
}

// ---------- 存檔 ----------
function save() {
  // 開場時鐘還在 1912–今天之間時不存檔，避免讀檔後時間錯亂
  if (!eng || eng.s.ended || phase === 'intro') return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ s: eng.s, gameTw, speed })); } catch { /* 空間不足或無痕模式 */ }
}
function loadSave(): { s: GameState; gameTw: number; speed: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d?.s?.version !== 1) return null;
    for (const p of d.s.pending) p.expiresDay = Infinity;
    d.gameTw = Math.max(d.gameTw ?? 0, d.s.startTw + d.s.day * DAY_MS - DAY_MS / 2);
    return d;
  } catch { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// ---------- 開局 ----------
function startEngine(s: GameState) {
  for (const uid of [...bubbles.keys()]) removeBubble(uid);
  eng = new Engine(ALL_EVENTS, s);
  attachHooks(eng);
  histDate = gameMonthDay();
  histAcc = HISTORY_EVERY;
  lastSaveDay = s.day;
  for (const p of s.pending) if (p.tier !== 'major') addBubble(p);
  buildStats(); buildLayers(); refreshLog(); refreshFeed(); refreshHud();
  $('title').hidden = true;
  $('hud').hidden = false;
  map.controls.autoRotate = false;
  sfx.ambient(0.55);
}

function newGame(fromTitle = false) {
  sfx.unlock();
  sfx.play('click');
  if (fromTitle && loadSave() && !confirm('開始新局會覆蓋目前的存檔，確定嗎？')) return;
  clearSave();
  // 標題畫面的種子碼決定整個世界；從其他地方開新局則換一個新種子碼
  const code = (fromTitle && normalizeCode($<HTMLInputElement>('seedInput').value)) || randomCode();
  const s = Engine.newGame(COUNTIES, codeToSeed(code), Date.now());
  s.code = code;
  syncSeedUrl(code);
  gameTw = ROC_START_TW;
  speed = 1; userPaused = false; introT = 0;
  phase = 'intro';
  closeModal(); showCounty(null);
  startEngine(s);
  histAcc = HISTORY_EVERY;
  prepareIntroFlashes(s.startTw);
  map.introFrom();
  map.flyTo(-25, 10, overviewDistance(), 9, 0.5);
}

// ---------- 開場：時鐘經過的歷史大事 ----------
let introEvents: { ts: number; text: string }[] = [];
let introIdx = 0;
let introShown = { text: '', at: 0 };
async function prepareIntroFlashes(untilTw: number) {
  introEvents = []; introIdx = 0; introShown = { text: '', at: 0 };
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => loadMonth(i + 1)));
  const list: { ts: number; text: string }[] = [];
  months.forEach(m => Object.entries(m).forEach(([k, arr]) => {
    const [mm, dd] = k.split('-').map(Number);
    for (const h of arr) if (h.k === 'event' && h.y >= 1912) list.push({ ts: Date.UTC(h.y, mm - 1, dd), text: `${h.y}・${h.t}` });
  }));
  introEvents = list.filter(x => x.ts <= untilTw).sort((a, b) => a.ts - b.ts);
  // 最後一行固定為開局提示，不讓跑動停在某一則歷史事件上；開場減速階段距開局 100 天時約剩 1.8 秒
  const last = introEvents[introEvents.length - 1]?.ts ?? 0;
  introEvents.push({ ts: Math.max(untilTw - 100 * DAY_MS, last + 1), text: '遊戲即將開始...' });
}
/** 回傳目前要顯示的大事；換字至少間隔 0.45 秒，高速時只挑最近經過的一件 */
function introFlash(): string {
  while (introIdx < introEvents.length && introEvents[introIdx].ts <= gameTw) introIdx++;
  const now = performance.now();
  const latest = introEvents[introIdx - 1];
  if (latest && latest.text !== introShown.text && now - introShown.at > 450) introShown = { text: latest.text, at: now };
  return introShown.text;
}

function overviewDistance() {
  const fovH = Math.tan(THREE.MathUtils.degToRad(map.camera.fov / 2)) * 2;
  return Math.max(470 / fovH, 300 / (fovH * map.camera.aspect));
}

function continueGame() {
  const d = loadSave();
  if (!d) return newGame();
  sfx.unlock();
  sfx.play('start');
  gameTw = d.gameTw; speed = d.speed || 1; userPaused = true; phase = 'play';
  startEngine(d.s);
  map.overview(true);
  const b = eng!.blocking();
  if (b) setTimeout(() => openModal(b.uid), 600);
  toast('<div class="t">已載入存檔</div><div>按下播放鍵繼續時間流動</div>', '#7fd6ff');
}

// ---------- 選單 ----------
function openMenu() {
  sfx.play('click');
  const wasPaused = userPaused;
  userPaused = true;
  const card = $('menuDlg').querySelector('.card') as HTMLElement;
  const camBtns = (['all', 'major', 'off'] as CamMode[]).map(m =>
    `<button data-cam="${m}" class="${settings.cam === m ? 'on' : ''}">${{ all: '全部事件', major: '僅重大', off: '關閉' }[m]}</button>`).join('');
  card.innerHTML = `<h2>選單</h2>
    <div class="setting"><span>事件鏡頭</span><div class="seg">${camBtns}</div></div>
    <div class="setting"><span>音效</span><div class="seg"><button data-snd="1" class="${sfx.muted ? '' : 'on'}">開</button><button data-snd="0" class="${sfx.muted ? 'on' : ''}">關</button></div></div>
    <div class="setting"><span>動態效果</span><div class="seg">${(['auto', 'full', 'reduce'] as MotionMode[]).map(m =>
      `<button data-motion="${m}" class="${settings.motion === m ? 'on' : ''}">${{ auto: '跟隨系統', full: '完整', reduce: '減少' }[m]}</button>`).join('')}</div></div>
    <div class="setting"><span>種子碼</span><span class="code-show">${eng?.s.code ?? eng?.s.seed ?? '-'}</span></div>
    <div class="menu-btns">
      <button class="btn primary" id="mResume">繼續</button>
      <button class="btn" id="mSaveQuit">存檔並回到標題</button>
      <button class="btn" id="mRestart">放棄本局，重新開始</button>
    </div>
    <p class="author menu-author">作者 gudubi・<a href="mailto:gudubi@gudubi.com">gudubi@gudubi.com</a><br>官方網站 <a href="https://gudubi.com" target="_blank" rel="noopener">gudubi.com</a><br>GitHub <a href="https://github.com/gudubi/fate-of-formosa" target="_blank" rel="noopener">gudubi/fate-of-formosa</a></p>`;
  $('menuDlg').hidden = false;
  card.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.onclick = () => { settings.cam = b.dataset.cam as CamMode; saveSettings(); openMenuRefresh(); });
  card.querySelectorAll<HTMLButtonElement>('[data-snd]').forEach(b => b.onclick = () => { sfx.setMuted(b.dataset.snd === '0'); refreshMute(); openMenuRefresh(); });
  card.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach(b => b.onclick = () => { settings.motion = b.dataset.motion as MotionMode; saveSettings(); applyMotion(); openMenuRefresh(); });
  const close = () => { $('menuDlg').hidden = true; userPaused = wasPaused; };
  const openMenuRefresh = () => { close(); openMenu(); userPaused = true; };
  $('mResume').onclick = () => { sfx.play('click'); close(); };
  $('mSaveQuit').onclick = () => { save(); close(); toTitle(); };
  $('mRestart').onclick = () => { if (confirm('確定放棄本局？')) { close(); newGame(); } };
}

function toTitle() {
  phase = 'title';
  closeModal(); showCounty(null);
  $('hud').hidden = true;
  $('title').hidden = false;
  $('btnContinue').hidden = !loadSave();
  renderRecords();
  refreshDexButton();
  setCode(randomCode());
  map.controls.autoRotate = !reducedMotion();
  map.overview(true);
}

const SEED_PARAM = 'seed';

/** 帶有種子碼的遊戲連結 */
function seedLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(SEED_PARAM, code);
  return url.toString();
}

/** 網址上的種子碼（?seed=XXXXXX），沒有則回傳空字串 */
function seedFromUrl(): string {
  return normalizeCode(new URLSearchParams(location.search).get(SEED_PARAM) ?? '').slice(0, 16);
}

/** 填入種子碼，並同步到目前網址（不重新載入），網址列本身就能直接分享 */
function setCode(code: string) {
  $<HTMLInputElement>('seedInput').value = code;
  syncSeedUrl(code);
}
function syncSeedUrl(code: string) {
  try { history.replaceState(null, '', code ? seedLink(code) : location.pathname); } catch { /* 部分內嵌環境不允許 */ }
}

function renderRecords() {
  const list = loadRecords().slice(0, 5);
  $('records').innerHTML = list.length ? `<summary>本機最佳紀錄</summary><ol>${list.map(r =>
    `<li ${r.code ? `data-code="${esc(r.code)}" title="使用這個種子碼再玩一次"` : ''}><b>${r.score}</b> ${esc(r.title)}・${r.years} 年${r.milestones ? `・🏅${r.milestones}` : ''}<small>${r.code ? `種子碼 ${esc(r.code)}` : `種子 ${r.seed}`}</small></li>`).join('')}</ol>` : '';
  $('records').querySelectorAll<HTMLElement>('li[data-code]').forEach(li => li.onclick = () => {
    sfx.play('click');
    setCode(li.dataset.code!);
  });
  $('records').hidden = !list.length;
  $('records').classList.toggle('is-open', ($('records') as HTMLDetailsElement).open);
  renderEndArchive();
}

// 標題頁「過往結局」：重看之前的結局畫面
function renderEndArchive() {
  const list = loadEndings();
  const box = $('endArchive') as HTMLDetailsElement;
  box.innerHTML = list.length ? `<summary>過往結局</summary><ul>${list.map((r, i) =>
    `<li data-i="${i}" title="重看這個結局"><b>${esc(r.title)}</b>成果指數 ${r.score}・${esc(r.years)} 年<small>${new Date(r.at).toLocaleDateString('zh-TW')}</small></li>`).join('')}</ul>` : '';
  box.querySelectorAll<HTMLElement>('li[data-i]').forEach(li => li.onclick = () => openArchived(list[Number(li.dataset.i)]));
  box.hidden = !list.length;
  box.classList.toggle('is-open', box.open);
}

function openArchived(r: EndingRecord) {
  sfx.play('click');
  const card = $('ending').querySelector('.card') as HTMLElement;
  card.innerHTML = `${endingShotHtml(r, BASE)}
    <div class="menu-btns">${r.code ? '<button class="btn primary" id="eAgain">用這個種子碼再玩</button>' : ''}<button class="btn" id="eClose">關閉</button></div>
    <details class="end-more"><summary>完整數據</summary>${endingGridHtml(r)}</details>`;
  $('ending').classList.add('archive');
  $('ending').hidden = false;
  card.scrollTop = 0;
  $('eClose').onclick = () => { sfx.play('click'); $('ending').hidden = true; };
  card.querySelector('#eAgain')?.addEventListener('click', () => { $('ending').hidden = true; setCode(r.code!); });
}

function refreshMute() {
  $('btnMute').innerHTML = sfx.muted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
}

// ---------- 輸入 ----------
function bindInput() {
  document.querySelectorAll<HTMLButtonElement>('#speed button').forEach(b => b.onclick = () => {
    if (!eng) return;
    sfx.play('click');
    const v = Number(b.dataset.speed);
    if (v === 0) userPaused = !userPaused;
    else { speed = v; userPaused = false; endIntro(); }
    refreshTop();
  });
  $('btnOverview').onclick = () => { sfx.play('click'); map.overview(true); };
  $('btnMute').onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); refreshMute(); };
  $('btnMenu').onclick = openMenu;
  $('btnNew').onclick = () => newGame(true);
  $('btnContinue').onclick = continueGame;
  $('btnDex').onclick = openDex;
  $('dexDlg').onclick = ev => { if (ev.target === $('dexDlg')) closeDex(); };
  document.querySelectorAll<HTMLDetailsElement>('#title details').forEach(d => animateDetails(d, reducedMotion));
  $('btnSeedRandom').onclick = () => { sfx.unlock(); sfx.play('click'); setCode(randomCode()); };
  $('btnSeedCopy').onclick = async () => {
    const btn = $('btnSeedCopy');
    const input = $<HTMLInputElement>('seedInput');
    let code = normalizeCode(input.value);
    if (!code) { code = randomCode(); setCode(code); }
    const link = seedLink(code);
    try { await navigator.clipboard.writeText(link); btn.textContent = '已複製'; } catch { window.prompt('複製這個連結分享給朋友', link); }
    setTimeout(() => { btn.textContent = '複製連結'; }, 1500);
  };
  $('seedInput').addEventListener('input', () => {
    const el = $<HTMLInputElement>('seedInput');
    el.value = el.value.toUpperCase();
    syncSeedUrl(normalizeCode(el.value));
  });
  $('history').onclick = () => void openHistory(...histDate);
  $('historyDlg').onclick = ev => { if (ev.target === $('historyDlg')) closeHistory(); };

  const panels = $('panels');
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach(b => b.onclick = () => {
    sfx.play('click');
    const on = b.classList.contains('on');
    if (on && !panels.classList.contains('collapsed')) { panels.classList.add('collapsed'); return; }
    panels.classList.remove('collapsed');
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('#panels .panel').forEach(p => p.classList.toggle('on', p.id === b.dataset.tab));
  });
  $('mini').onclick = () => (document.querySelector('#tabs button.on') as HTMLButtonElement)?.click();

  map.controls.addEventListener('start', () => { lastInteract = performance.now(); });
  const canvas = map.renderer.domElement;
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', ev => {
    if (!down || phase === 'title') return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 8 || !quick) return;
    const hit = map.pick(ev.clientX, ev.clientY);
    if (isMobile()) $('panels').classList.add('collapsed');
    showCounty(hit?.county ?? null);
    if (hit?.county !== null && hit?.county !== undefined) sfx.play('click');
  });

  window.addEventListener('keydown', ev => {
    if (phase === 'title' || !eng) return;
    if (ev.code === 'Space') { ev.preventDefault(); userPaused = !userPaused; }
    else if (ev.key >= '1' && ev.key <= '3') { speed = Number(ev.key); userPaused = false; }
    else if (ev.key === 'Escape') {
      showCounty(null);
      if (!$('menuDlg').hidden) $('menuDlg').hidden = true;
      if (historyOpen) closeHistory();
      if (reviewOpen) closeReview();
      // 一般事件可以稍後再決定；重大事件必須做出選擇
      const p = openUid !== null ? eng.s.pending.find(x => x.uid === openUid) : null;
      if (p && p.tier !== 'major') closeModal();
    }
  });
  window.addEventListener('resize', () => { map.resize(); labelY = []; syncLayersHeight(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && eng && (phase === 'play' || phase === 'intro')) { userPaused = true; save(); }
  });
  window.addEventListener('pagehide', save);
}

// ---------- 啟動 ----------
async function boot() {
  map = await MapScene.create($<HTMLCanvasElement>('gl'), await loadRaster());
  map.controls.autoRotate = !reducedMotion();
  map.controls.autoRotateSpeed = 0.25;
  applyMotion();
  bindInput();
  refreshMute();
  renderRecords();
  refreshDexButton();
  // 從分享連結進來（?seed=XXXXXX）時直接帶入種子碼
  setCode(seedFromUrl() || randomCode());
  const btn = $<HTMLButtonElement>('btnNew');
  btn.disabled = false;
  btn.textContent = '降臨・開始新局';
  $('btnContinue').hidden = !loadSave();
  requestAnimationFrame(frame);
}

refreshTitleClock();
// 先讓標題畫面繪出，再建構地圖
setTimeout(() => void boot(), 50);

// 離線遊玩：正式版註冊 Service Worker
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => { /* 不支援時照常遊玩 */ }); });
}

// 開發用：主控台輸入 __dbg.ff(365) 快轉一年
if (import.meta.env.DEV) {
  (window as any).__dbg = {
    eng: () => eng,
    map: () => map,
    ff(days: number) {
      for (let i = 0; i < days && eng && !eng.s.ended; i++) {
        const b = eng.blocking();
        if (b) eng.resolve(b.uid, null); else eng.tick();
      }
      if (eng) gameTw = eng.dateTw(eng.s.day) + DAY_MS / 2;
      refreshHud(); refreshLog(); refreshFeed();
    },
    draw(dt = 0.016) { map.render(dt); updateLabels(); },
    review: () => openReview(),
  };
}
