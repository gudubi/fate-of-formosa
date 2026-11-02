import './style.css';
import * as THREE from 'three';
import { MapScene } from './render/mapScene';
import { COUNTIES } from './map/mapData';
import { lonLatToKm } from './map/projection';
import { Engine, DAY_MS, DIVINE_MAX, STAT_ORDER, describeLean, type GameState, type LogEntry, type Pending, type Ending } from './sim/engine';
import { NAMED_POINTS } from './sim/countyData';
import type { StatKey } from './sim/types';
import { ALL_EVENTS } from './data/events';
import { validateEvents } from './sim/validate';
import { STAT_META, CAT_META, LAYERS, ramp, iconSvg, HAND_ICON, catColor, LEAN_NEG, LEAN_POS, type LayerKey } from './ui/meta';
import { sfx } from './audio/sfx';
import { entriesOn, entriesOnSync, KIND_LABEL, type HistoryKind } from './data/history';

const SPEEDS = [0, 4, 8, 16];       // 天／秒
// 開場：日期從中華民國建立（1912-01-01）開始以遊戲速度跳動，
// 接著指數加速穿越歷史，接近此刻時減速，銜接標準遊戲速度（約 12 秒）
const ROC_START_TW = Date.UTC(1912, 0, 1);
const INTRO_GROWTH = 2.0;           // 加速度（倍率每秒乘以 e^2）
const INTRO_PEAK = 6e8;             // 最高倍率：約每秒 19 年，讓年份清楚可見
const INTRO_SETTLE = 0.5;           // 接近此刻時的減速時間常數（秒）
const TICK_GAP = 70;                // 滴答聲最短間隔（毫秒）
const SAVE_KEY = 'tgh-save-v1';
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
const settings: { cam: CamMode } = { cam: 'all' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

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

function place(el: HTMLElement, x: number, yw: number, z: number): boolean {
  const p = map.toScreen(x, yw, z);
  if (!p) { el.style.display = 'none'; return false; }
  el.style.display = '';
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  return true;
}

function updateLabels() {
  const d = map.cameraDistance();
  const showCounty = d < (isMobile() ? 430 : 560);
  countyLabels.forEach((el, i) => {
    el.style.opacity = showCounty ? '1' : '0';
    if (!showCounty) return;
    const l = map.raster.labels[i];
    place(el, l.x, map.surfaceY(l.x, l.y) + 1, l.y);
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
  return !eng || !!eng.s.ended || !!eng.blocking() || openUid !== null || userPaused || historyOpen;
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
    : `第 ${year} 年 · ${SPEEDS[speed]} 天/秒 ${status}`;
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
    acc.innerHTML = `<div class="big">${d.getUTCFullYear()}<small>年</small>${String(d.getUTCMonth() + 1).padStart(2, '0')}<small>月</small>${String(d.getUTCDate()).padStart(2, '0')}<small>日</small></div>`;
  }
}

// ---------- 數值面板 ----------
const statEls = new Map<StatKey, { root: HTMLElement; val: HTMLElement; tr: HTMLElement; fill: HTMLElement; mark?: HTMLElement }>();
function buildStats() {
  const root = $('stats');
  root.innerHTML = '';
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
}

function isDanger(k: StatKey, v: number) {
  const d = STAT_META[k].danger;
  return (d === 'low' && v < 22) || (d === 'high' && v > 80);
}

let wasDanger = false;
function refreshStats() {
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
    const diff = v - ref[i];
    el.tr.textContent = diff > 1 ? '▲' : diff < -1 ? '▼' : '';
    el.tr.className = `tr ${diff > 1 ? 'up' : diff < -1 ? 'down' : ''}`;
    const dg = isDanger(k, v);
    anyDanger ||= dg;
    el.root.classList.toggle('danger', dg);
  }
  if (anyDanger && !wasDanger) sfx.play('warn');
  wasDanger = anyDanger;

  const mini: StatKey[] = ['stability', 'wealth', 'gdp', 'tension', 'govLean', 'popLean', 'intl', 'trust'];
  $('mini').innerHTML = mini.map(k => {
    const v = st[k], m = STAT_META[k];
    const txt = m.lean ? `${v > 0 ? '+' : ''}${Math.round(v)}` : Math.round(v);
    return `<span class="mchip ${isDanger(k, v) ? 'danger' : ''}">${m.short}<b>${txt}</b></span>`;
  }).join('');
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
}

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
  return Object.entries(d).map(([k, v]) => {
    const m = STAT_META[k as StatKey];
    const good = m.lean ? 'l' : (m.danger === 'high' ? v! < 0 : v! > 0) ? 'p' : 'n';
    return `<span class="chip-d ${good}">${m.short}${v! > 0 ? '+' : ''}${v}</span>`;
  }).join('');
}

function refreshFeed() {
  const e = eng!;
  const pend = e.s.pending.filter(p => p.tier !== 'major');
  $('pendingList').innerHTML = pend.length ? pend.map(p => {
    const d = e.defs.get(p.eventId)!, c = CAT_META[d.cat];
    const left = Math.max(0, p.expiresDay - e.s.day), frac = left / (p.expiresDay - p.createdDay);
    return `<div class="ev pend" data-uid="${p.uid}" style="--c:${c.color}"><span class="ic">${iconSvg(d.cat)}</span>
      <div class="body"><div class="t">${esc(d.title)}</div><div class="m">${c.label} · ${esc(e.placeName(p))} · 剩 ${left} 天</div>
      <div class="timer"><div style="width:${frac * 100}%"></div></div></div></div>`;
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
  setTimeout(nextTicker, 3200);
}

function toast(html: string, color: string, ms = 4200) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast'; el.style.setProperty('--c', color); el.innerHTML = html;
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild!.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, ms);
}

// ---------- 泡泡 ----------
function addBubble(p: Pending) {
  const d = eng!.defs.get(p.eventId)!;
  const el = document.createElement('button');
  el.className = `bubble ${p.tier === 'major' ? 'major' : ''}`;
  el.style.setProperty('--c', CAT_META[d.cat].color);
  el.innerHTML = iconSvg(d.cat, p.tier === 'major' ? 22 : 18);
  el.title = d.title;
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
      sfx.play(d.cat);
      const idle = performance.now() - lastInteract > 6000;
      // 4 倍速時一般事件太密集，只在 1、2 倍速自動移動鏡頭
      if (settings.cam === 'all' && idle && openUid === null && speed < 3) map.flyTo(x, y, isMobile() ? 360 : 300, 1.6, 0.7);
      refreshFeed();
    },
    major: p => {
      const d = e.defs.get(p.eventId)!;
      const { x, y, zoom } = locXY(p.county, p.point);
      map.ripple(x, y, catColor(d.cat), p.county !== null ? 34 : 80, 8);
      map.highlight(p.county, catColor(d.cat), 8);
      sfx.play('major');
      setTimeout(() => sfx.play(d.cat), 400);
      if (settings.cam !== 'off') map.flyTo(x, y, zoom * (isMobile() ? 1.35 : 1), 1.3, 0.85);
      setTimeout(() => { if (e === eng && e.s.pending.some(q => q.uid === p.uid)) openModal(p.uid); }, settings.cam === 'off' ? 300 : 1300);
    },
    resolved: (l, p) => {
      removeBubble(p.uid);
      if (openUid !== p.uid) {
        toast(`<div class="t">${esc(l.title)}・${esc(l.optionText ?? '')}</div><div>${esc(l.result ?? '')}</div>${deltaChips(l.deltas)}`, CAT_META[l.cat].color);
      }
      refreshLog(); refreshFeed();
    },
    ended: end => setTimeout(() => showEnding(end), 1200),
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
  const isMajor = p.tier === 'major';
  const left = isMajor ? 0 : Math.max(0, p.expiresDay - e.s.day);
  card.innerHTML = `
    <div class="ev-hero" style="background-image:radial-gradient(120% 140% at 20% 0%, ${c.color}, transparent 60%), url('/assets/events/${d.cat}.webp')"><span class="ic">${iconSvg(d.cat, 40)}</span></div>
    <div class="ev-head">
      <div class="ev-kind"><span class="pill">${c.label}</span><span>${isMajor ? '重大事件' : '事件'} · ${esc(e.placeName(p))} · ${shortDate(e.s.day)}</span></div>
      <div class="ev-title">${esc(d.title)}</div>
    </div>
    <div class="ev-desc">${esc(e.text(d.desc, p))}</div>
    <div class="opts">${d.options!.map((o, i) => `
      <button class="opt" data-i="${i}" ${e.s.divine < costs[i] ? 'disabled' : ''}>
        <div class="p" style="width:${probs[i] * 100}%"></div>
        <div class="row"><span class="tx">${esc(o.text)}</span><span class="pr">天意 ${Math.round(probs[i] * 100)}%</span>
        <span class="cost">${HAND_ICON}${costs[i]}</span></div>
      </button>`).join('')}</div>
    <div class="ev-foot">
      <span class="note">點選項＝以神力干預 ｜ 目前神力 ${e.s.divine}${isMajor ? ' ｜ 順其自然 +1 神力' : ` ｜ ${left} 天後自動交給天意`}</span>
      ${isMajor ? '' : '<button class="btn" id="mLater">稍後</button>'}
      <button class="btn fate" id="mFate">順其自然</button>
    </div>`;
  $('modal').hidden = false;
  card.querySelectorAll<HTMLButtonElement>('.opt').forEach(b => b.onclick = () => choose(uid, Number(b.dataset.i)));
  $('mFate').onclick = () => choose(uid, null);
  const later = document.getElementById('mLater');
  if (later) later.onclick = () => closeModal();
}

function closeModal(returnCam = false) {
  $('modal').hidden = true;
  openUid = null;
  if (returnCam && settings.cam !== 'off') map.overview(true);
}

function choose(uid: number, i: number | null) {
  const e = eng!;
  const card = $('modal').querySelector('.card') as HTMLElement;
  const p = e.s.pending.find(x => x.uid === uid);
  if (!p) return closeModal();
  const isMajor = p.tier === 'major';
  const res = e.resolve(uid, i);
  if (!res) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); return; }
  card.querySelectorAll<HTMLButtonElement>('.opt, .btn').forEach(b => b.disabled = true);
  const opts = [...card.querySelectorAll<HTMLElement>('.opt')];
  const finish = () => {
    opts[res.option]?.classList.add('picked');
    sfx.play('resolve');
    const foot = card.querySelector('.ev-foot')!;
    foot.insertAdjacentHTML('beforebegin', `<div class="result"><b>${res.intervened ? '✋ 你出手了：' : '天意：'}${esc(res.optionText ?? '')}</b><br>${esc(res.result ?? '')}<div>${deltaChips(res.deltas)}</div></div>`);
    foot.innerHTML = `<span class="note"></span><button class="btn primary" id="mOk">繼續</button>`;
    $('mOk').onclick = () => { sfx.play('click'); closeModal(isMajor); };
    refreshHud();
  };
  if (i === null) {
    // 擲骰動畫：在選項間跳動後停在天意結果
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
  const intervened = e.s.log.filter(l => l.intervened).length;
  card.innerHTML = `
    <div class="end-kicker">${end.survived ? '守護之路・' : '終局・'}${shortDate(end.day)}・第 ${years} 年</div>
    <div class="end-title">${esc(end.title)}</div>
    <img class="end-img" src="/assets/endings/${end.id}.webp" alt="" onerror="this.remove()">
    <p class="end-text">${esc(end.text)}</p>
    <div class="end-grid">
      <div>綜合評分<b>${end.score}</b></div>
      <div>守護年數<b>${years}</b></div>
      <div>出手干預<b>${intervened} 次</b></div>
      ${STAT_ORDER.map(k => `<div>${STAT_META[k].label}<b>${STAT_META[k].lean ? describeLean(e.s.stats[k]) : Math.round(e.s.stats[k])}</b></div>`).join('')}
    </div>
    <canvas id="endChart"></canvas>
    <div class="chart-keys"></div>
    <div class="menu-btns"><button class="btn primary" id="eNew">再守護一次</button><button class="btn" id="eView">回到地圖</button></div>`;
  $('ending').hidden = false;
  const shown = new Set<StatKey>(['govLean', 'popLean', 'stability', 'gdp', 'tension']);
  const palette = ['#9d6bd8', '#e2a93b', '#3fd0ff', '#ffd166', '#f28482', '#4fb0c6', '#ff4d5e', '#b8c0ff', '#90be6d', '#c77dff', '#f9c74f'];
  const keys = card.querySelector('.chart-keys')!;
  const draw = () => drawChart($('endChart') as HTMLCanvasElement, e.s, shown, palette);
  keys.innerHTML = STAT_ORDER.map((k, i) => `<button data-k="${k}" style="--k:${palette[i]}" class="${shown.has(k) ? '' : 'off'}">${STAT_META[k].label}</button>`).join('');
  keys.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
    const k = b.dataset.k as StatKey;
    if (shown.has(k)) shown.delete(k); else shown.add(k);
    b.classList.toggle('off');
    draw();
  });
  requestAnimationFrame(draw);
  $('eNew').onclick = () => { $('ending').hidden = true; newGame(); };
  $('eView').onclick = () => { $('ending').hidden = true; };
}

function drawChart(cv: HTMLCanvasElement, s: GameState, shown: Set<StatKey>, palette: string[]) {
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
  STAT_ORDER.forEach((k, i) => {
    if (!shown.has(k)) return;
    const lean = STAT_META[k].lean;
    ctx.strokeStyle = palette[i]; ctx.lineWidth = 1.8; ctx.beginPath();
    s.history.forEach((p, j) => {
      const v = lean ? (p.s[i] + 100) / 2 : p.s[i];
      if (j) ctx.lineTo(X(p.day), Y(v)); else ctx.moveTo(X(p.day), Y(v));
    });
    ctx.stroke();
  });
}

// ---------- 存檔 ----------
function save() {
  if (!eng || eng.s.ended) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ s: eng.s, gameTw, speed })); } catch { /* 空間不足或無痕模式 */ }
}
function loadSave(): { s: GameState; gameTw: number; speed: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d?.s?.version !== 1) return null;
    for (const p of d.s.pending) if (p.tier === 'major') p.expiresDay = Infinity;
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

function newGame() {
  sfx.unlock();
  sfx.play('click');
  clearSave();
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const s = Engine.newGame(COUNTIES, seed, Date.now());
  gameTw = ROC_START_TW;
  speed = 1; userPaused = false; introT = 0;
  phase = 'intro';
  closeModal(); showCounty(null);
  startEngine(s);
  histAcc = HISTORY_EVERY;
  map.introFrom();
  map.flyTo(-25, 10, overviewDistance(), 9, 0.5);
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
    <div class="setting"><span>隨機種子</span><span style="color:var(--dim)">${eng?.s.seed ?? '-'}</span></div>
    <div class="menu-btns">
      <button class="btn primary" id="mResume">繼續</button>
      <button class="btn" id="mSaveQuit">存檔並回到標題</button>
      <button class="btn" id="mRestart">放棄本局，重新開始</button>
    </div>`;
  $('menuDlg').hidden = false;
  card.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.onclick = () => { settings.cam = b.dataset.cam as CamMode; saveSettings(); openMenuRefresh(); });
  card.querySelectorAll<HTMLButtonElement>('[data-snd]').forEach(b => b.onclick = () => { sfx.setMuted(b.dataset.snd === '0'); refreshMute(); openMenuRefresh(); });
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
  map.controls.autoRotate = true;
  map.overview(true);
}

function refreshMute() {
  $('btnMute').innerHTML = sfx.muted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
}

// ---------- 輸入 ----------
function bindInput() {
  document.querySelectorAll<HTMLButtonElement>('#speed button').forEach(b => b.onclick = () => {
    sfx.play('click');
    const v = Number(b.dataset.speed);
    if (v === 0) userPaused = !userPaused;
    else { speed = v; userPaused = false; endIntro(); }
    refreshTop();
  });
  $('btnOverview').onclick = () => { sfx.play('click'); map.overview(true); };
  $('btnMute').onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); refreshMute(); };
  $('btnMenu').onclick = openMenu;
  $('btnNew').onclick = newGame;
  $('btnContinue').onclick = continueGame;
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
    }
  });
  window.addEventListener('resize', () => map.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && eng && (phase === 'play' || phase === 'intro')) { userPaused = true; save(); }
  });
  window.addEventListener('pagehide', save);
}

// ---------- 啟動 ----------
function boot() {
  map = new MapScene($<HTMLCanvasElement>('gl'));
  map.controls.autoRotate = true;
  map.controls.autoRotateSpeed = 0.25;
  bindInput();
  refreshMute();
  const btn = $<HTMLButtonElement>('btnNew');
  btn.disabled = false;
  btn.textContent = '降臨・開始新局';
  $('btnContinue').hidden = !loadSave();
  requestAnimationFrame(frame);
}

refreshTitleClock();
// 先讓標題畫面繪出，再建構地圖（約需數百毫秒）
setTimeout(boot, 50);

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
  };
}
