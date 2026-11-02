import type { EventDef } from './types';
import { STAT_ORDER } from './engine';
import { COUNTY_BASE, NAMED_POINTS } from './countyData';
import { SYSTEM_EVENTS } from './systemEvents';

const READ = new Set<string>([...STAT_ORDER, 'gap', 'absGov', 'absPop', 'year', 'elapsed', 'dep']);
const EFFECT = new Set<string>([...STAT_ORDER, 'govToPop', 'popToGov', 'dep']);
const POLICY = new Set(['gdp', 'trust', 'tension', 'intl', 'defense', 'tech', 'demo', 'stability', 'wealth']);
const LOCAL = new Set(['popLean', 'stability', 'wealth']);

/** 檢查事件資料，回傳錯誤訊息清單 */
export function validateEvents(events: EventDef[]): string[] {
  const errs: string[] = [];
  const all = [...SYSTEM_EVENTS, ...events];
  const ids = new Set<string>();
  for (const e of all) {
    const at = (m: string) => errs.push(`${e.id}: ${m}`);
    if (ids.has(e.id)) at('重複 id');
    ids.add(e.id);
    if (!['news', 'general', 'major'].includes(e.tier)) at(`tier ${e.tier}`);
    const locs = typeof e.loc === 'string' ? [e.loc] : e.loc;
    for (const l of locs) if (l !== 'random' && !COUNTY_BASE[l] && !NAMED_POINTS[l]) at(`地點 ${l}`);
    for (const m of e.mods ?? []) if (!READ.has(m.stat)) at(`mod ${m.stat}`);
    for (const c of e.cond ?? []) if (!READ.has(c[0])) at(`cond ${c[0]}`);
    const chkEff = (x: object | undefined, set: Set<string>) => {
      for (const k of Object.keys(x ?? {})) if (!set.has(k)) at(`效果 ${k}`);
    };
    chkEff(e.effects, EFFECT); chkEff(e.local, LOCAL);
    if (e.tier !== 'news' && (e.options?.length ?? 0) < 2) at('選項不足');
    for (const v of e.variants ?? []) if (!v.title) at('變體缺標題');
    for (const o of e.options ?? []) {
      chkEff(o.effects, EFFECT); chkEff(o.local, LOCAL); chkEff(o.over?.effects, EFFECT);
      for (const m of o.mods ?? []) if (!READ.has(m.stat)) at(`option mod ${m.stat}`);
      for (const pl of o.policy ?? []) if (!POLICY.has(pl.stat) || !(pl.days > 0)) at(`policy ${pl.stat}`);
      if (!(o.weight > 0)) at(`權重 ${o.text}`);
    }
  }
  for (const e of all) for (const o of e.options ?? []) for (const f of o.follow ?? []) {
    if (!ids.has(f.id)) errs.push(`${e.id}: follow ${f.id} 不存在`);
  }
  return errs;
}
