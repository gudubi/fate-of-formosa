// 事件選項的效果預覽：只顯示方向與粗略幅度，讓選擇有依據但保留不確定性
import type { OptionDef, StatKey } from '../sim/types';
import { STAT_META } from './meta';

/** 把立即、持續與長期效果合併成每個數值的方向與份量 */
function collect(o: OptionDef) {
  const now: Partial<Record<string, number>> = {};
  const later: Partial<Record<string, number>> = {};
  const add = (m: Partial<Record<string, number>>, k: string, v: number) => { m[k] = (m[k] ?? 0) + v; };
  for (const [k, v] of Object.entries(o.effects ?? {})) add(now, k, v as number);
  for (const [k, v] of Object.entries(o.local ?? {})) add(now, k, (v as number) * 0.3);
  for (const [k, v] of Object.entries(o.over?.effects ?? {})) add(later, k, v as number);
  for (const p of o.policy ?? []) add(later, p.stat, p.shift);
  return { now, later };
}

const arrows = (v: number) => {
  const a = Math.abs(v), n = a < 2 ? 1 : a < 6 ? 2 : 3;
  return (v > 0 ? '▲' : '▼').repeat(n);
};

function label(k: string): string {
  if (k === 'dep') return '依賴';
  if (k === 'govToPop') return '政府向民意';
  if (k === 'popToGov') return '民意向政府';
  return STAT_META[k as StatKey]?.short ?? k;
}

function chip(k: string, v: number, long: boolean): string {
  if (Math.abs(v) < 0.3) return '';
  if (k === 'govToPop' || k === 'popToGov') return `<span class="pv lean">${label(k)}靠攏</span>`;
  const meta = STAT_META[k as StatKey];
  if (meta?.lean) return `<span class="pv lean${long ? ' long' : ''}">${meta.short}${v > 0 ? '→獨' : '→統'}</span>`;
  const bad = k === 'tension' || k === 'dep' ? v > 0 : v < 0;
  // 類別名稱刻意不用 p／n：選項內的機率條已使用 .p
  return `<span class="pv ${bad ? 'bad' : 'good'}${long ? ' long' : ''}">${label(k)}${arrows(v)}</span>`;
}

/** 回傳選項下方的預覽標籤 HTML */
export function optionPreview(o: OptionDef): string {
  if (o.ending) return '<span class="pv warn">歷史將就此轉折</span>';
  const { now, later } = collect(o);
  const parts = [
    ...Object.entries(now).map(([k, v]) => chip(k, v!, false)),
    ...Object.entries(later).map(([k, v]) => chip(k, v!, true)),
  ].filter(Boolean);
  if (o.follow?.length) parts.push('<span class="pv warn">可能引發後續</span>');
  return parts.join('');
}

/** 結算後的長期影響說明 */
export function lastingNote(o: OptionDef, days: (d: number) => string): string {
  const notes: string[] = [];
  for (const p of o.policy ?? []) notes.push(`${label(p.stat)}長期${p.shift > 0 ? '上升' : '下降'}（${days(p.days)}）`);
  if (o.over) notes.push(`影響將在 ${days(o.over.days)} 內持續發酵`);
  if (o.follow?.length) notes.push('之後可能引發後續事件');
  return notes.join('；');
}
