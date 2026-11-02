// 彩蛋圖鑑：跨局記錄看過哪些彩蛋（只存在這台裝置的瀏覽器中）
import type { EventDef } from '../sim/types';
import { CAT_META } from './meta';
import { optionPreview } from './preview';
import { NAMED_POINTS } from '../sim/countyData';

const KEY = 'tgh-eggs-v1';

export interface DexEntry {
  /** 第一次遇到的真實日期（ISO） */
  first: string;
  /** 遇過幾局 */
  count: number;
  /** 看過的選項（索引） */
  opts: number[];
  /** 遇到時的種子碼（最多記 5 個） */
  codes: string[];
  /** 看過的後續事件 id */
  follows: string[];
  /** 後續事件看過的選項 */
  fopts?: Record<string, number[]>;
}
export type Dex = Record<string, DexEntry>;

export function loadDex(): Dex {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Dex; } catch { return {}; }
}
function saveDex(d: Dex) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 無痕模式 */ }
}

/** 彩蛋與後續事件的對應：後續事件 id → 母事件 id */
export function eggParents(defs: Iterable<EventDef>): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of defs) if (d.egg && !d.chainOnly) {
    for (const o of d.options ?? []) for (const f of o.follow ?? []) m.set(f.id, d.id);
  }
  // 後續事件的後續（若有）也歸到最上層母事件
  for (const [child, parent] of m) if (m.has(parent)) m.set(child, m.get(parent)!);
  return m;
}

/** 記錄一次彩蛋結算。isNewGame：這局第一次遇到這個彩蛋時才累計局數 */
export function recordEgg(id: string, option: number, code: string | undefined, parents: Map<string, string>, isNewGame: boolean): boolean {
  const dex = loadDex();
  const parent = parents.get(id);
  const key = parent ?? id;
  const fresh = !dex[key];
  const e = dex[key] ??= { first: new Date().toISOString(), count: 0, opts: [], codes: [], follows: [] };
  if (parent) {
    if (!e.follows.includes(id)) e.follows.push(id);
    const seen = (e.fopts ??= {})[id] ??= [];
    if (option >= 0 && !seen.includes(option)) seen.push(option);
  } else {
    if (isNewGame) e.count++;
    if (option >= 0 && !e.opts.includes(option)) e.opts.push(option);
    if (code && !e.codes.includes(code)) e.codes = [...e.codes, code].slice(-5);
  }
  saveDex(dex);
  return fresh;
}

const starStr = (n: number) => '★'.repeat(n) + '☆'.repeat(4 - n);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 未解鎖與已解鎖的卡片共用同一個結構，每一列高度一致 */
function art(d: EventDef, base: string, color: string, locked: boolean): string {
  if (locked) return `<div class="dex-art locked-art"><span>？</span></div>`;
  return `<div class="dex-art" style="background-image:url('${base}assets/eggs/${d.id}.webp'), radial-gradient(120% 140% at 20% 0%, ${color}, transparent 65%), url('${base}assets/events/${d.cat}.webp')"></div>`;
}

/** 圖鑑對話框：卡片列表 */
export function dexHtml(defs: EventDef[], base: string): string {
  const dex = loadDex();
  const eggs = defs.filter(d => d.egg && !d.chainOnly);
  const got = eggs.filter(d => dex[d.id]).length;
  const cards = eggs.map((d, i) => {
    const e = dex[d.id], c = CAT_META[d.cat], info = d.egg!;
    const no = String(i + 1).padStart(2, '0');
    if (!e) {
      return `<div class="dex-card locked" style="--c:${c.color}">
        ${art(d, base, c.color, true)}
        <div class="dex-row"><span class="dex-no">No.${no}</span><span class="dex-stars">${starStr(info.stars)}</span></div>
        <div class="dex-title">？？？</div>
        <div class="dex-hint">${esc(info.hint)}</div></div>`;
    }
    const stamps = (d.options ?? []).map((_, j) => `<span class="stamp ${e.opts.includes(j) ? 'on' : ''}"></span>`).join('');
    const follows = followsOf(d, defs);
    return `<button class="dex-card" data-id="${d.id}" style="--c:${c.color}" title="查看詳細說明">
      ${art(d, base, c.color, false)}
      <div class="dex-row"><span class="dex-no">No.${no}・${c.label}</span><span class="dex-stars">${starStr(info.stars)}</span></div>
      <div class="dex-title">${esc(d.title.replaceAll('{county}', ''))}</div>
      <div class="dex-meta">遇過 ${e.count} 局</div>
      <div class="dex-stamps" title="看過的結局">${stamps}${follows.length ? `<span class="dex-follow ${follows.some(f => e.follows.includes(f.id)) ? 'on' : ''}">後續</span>` : ''}</div></button>`;
  }).join('');
  return `<div class="dex-head"><h2>彩蛋圖鑑</h2><div class="dex-count">${got} / ${eggs.length}</div></div>
    <p class="dex-note">島上偶爾會發生一些說不清的事。每一局最多遇到 3 個，越到後期越容易出現。點開已解鎖的卡片可以看詳細說明與各個選項。紀錄只存在這台裝置。</p>
    <div class="dex-grid">${cards}</div>
    <div class="menu-btns"><button class="btn primary" id="dexClose">關閉</button></div>`;
}

function followsOf(d: EventDef, defs: EventDef[]): EventDef[] {
  const ids = new Set((d.options ?? []).flatMap(o => o.follow?.map(f => f.id) ?? []));
  return defs.filter(x => x.chainOnly && ids.has(x.id));
}

function placeText(d: EventDef): string {
  if (d.loc === 'random') return '全台各地';
  const list = (typeof d.loc === 'string' ? [d.loc] : d.loc).map(l => NAMED_POINTS[l]?.label ?? l);
  return list.join('、');
}

/** 內文中的 {county} 改成「某地」，並標示出來 */
const descText = (t: string) => esc(t).replaceAll('{county}', '<span class="dex-somewhere">某地</span>');

/** 一個事件的選項列表：看過的結局顯示結果，沒看過的只顯示選項與影響方向 */
function optionsHtml(d: EventDef, seen: number[]): string {
  return (d.options ?? []).map((o, j) => {
    const on = seen.includes(j);
    return `<div class="dex-opt ${on ? 'seen' : ''}">
      <div class="dex-opt-head"><span class="stamp ${on ? 'on' : ''}"></span><b>${esc(o.text)}</b></div>
      <div class="dex-opt-res">${on ? esc(o.result ?? '') : '這個結局還沒有看過'}</div>
      <div class="pvs">${optionPreview(o)}</div></div>`;
  }).join('');
}

/** 圖鑑：單一彩蛋的詳細頁 */
export function dexDetailHtml(id: string, defs: EventDef[], base: string): string {
  const dex = loadDex();
  const eggs = defs.filter(d => d.egg && !d.chainOnly);
  const d = eggs.find(x => x.id === id)!, e = dex[id], c = CAT_META[d.cat], info = d.egg!;
  const no = String(eggs.indexOf(d) + 1).padStart(2, '0');
  const follows = followsOf(d, defs).map(f => {
    const seenF = e.follows.includes(f.id);
    return seenF
      ? `<div class="dex-sub"><h4>後續：${esc(f.title.replaceAll('{county}', '某地'))}</h4><p class="dex-desc">${descText(f.desc)}</p>
         <div class="dex-opts">${optionsHtml(f, e.fopts?.[f.id] ?? [])}</div></div>`
      : `<div class="dex-sub locked"><h4>後續：？？？</h4><p class="dex-desc">某個選擇會在幾年後引出另一段故事。${esc(f.egg?.hint ?? '')}</p></div>`;
  }).join('');
  return `<div class="dex-detail" style="--c:${c.color}">
    <button class="dex-back" id="dexBack">‹ 返回圖鑑</button>
    <div class="dex-hero" style="background-image:url('${base}assets/eggs/${d.id}.webp'), radial-gradient(120% 140% at 20% 0%, ${c.color}, transparent 65%), url('${base}assets/events/${d.cat}.webp')">
      <span class="pill">No.${no}・${c.label}・${d.tier === 'major' ? '重大事件' : '事件'}</span><span class="dex-stars">${starStr(info.stars)}</span></div>
    <h3 class="dex-dtitle">${esc(d.title.replaceAll('{county}', '某地'))}</h3>
    <div class="dex-dmeta">出現地點：${esc(placeText(d))}<br>首次遇見 ${e.first.slice(0, 10).replaceAll('-', '/')}・遇過 ${e.count} 局${e.codes.length ? `・最近的種子碼 <b>${esc(e.codes[e.codes.length - 1])}</b>` : ''}</div>
    <p class="dex-desc">${descText(d.desc)}</p>
    <h4 class="dex-sec">選項（看過 ${e.opts.length} / ${(d.options ?? []).length} 個結局）</h4>
    <div class="dex-opts">${optionsHtml(d, e.opts)}</div>
    ${follows}
    <div class="menu-btns"><button class="btn" id="dexBack2">返回圖鑑</button></div></div>`;
}

export function dexProgress(defs: EventDef[]): { got: number; total: number } {
  const dex = loadDex();
  const eggs = defs.filter(d => d.egg && !d.chainOnly);
  return { got: eggs.filter(d => dex[d.id]).length, total: eggs.length };
}
