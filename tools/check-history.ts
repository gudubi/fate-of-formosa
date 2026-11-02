// 檢查「歷史上的今天」資料：格式、日期涵蓋、長度、重複
// 執行：npx tsx tools/check-history.ts
import { readFileSync, existsSync } from 'node:fs';
import type { HistoryEntry } from '../src/data/history';

const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const KINDS = new Set(['event', 'birth', 'other']);
const errs: string[] = [];
let total = 0, thin = 0;
const kinds: Record<string, number> = {};
const seen = new Map<string, string>();

for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  const file = `src/data/history/${mm}.json`;
  if (!existsSync(file)) { errs.push(`${mm}.json 不存在`); continue; }
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, HistoryEntry[]>;
  for (const key of Object.keys(data)) {
    const [km, kd] = key.split('-').map(Number);
    if (km !== m || !(kd >= 1 && kd <= DAYS[m - 1])) errs.push(`${mm}.json：無效日期 ${key}`);
  }
  for (let d = 1; d <= DAYS[m - 1]; d++) {
    const key = `${mm}-${String(d).padStart(2, '0')}`;
    const list = data[key] ?? [];
    if (!list.length) errs.push(`${key} 沒有條目`);
    if (list.length < 2) thin++;
    for (const e of list) {
      total++;
      kinds[e.k] = (kinds[e.k] ?? 0) + 1;
      const at = `${key} ${e.y} ${e.t}`;
      if (!Number.isInteger(e.y) || e.y < 1500 || e.y > 2026) errs.push(`${at}：年份`);
      if (!KINDS.has(e.k)) errs.push(`${at}：類別 ${e.k}`);
      if (!e.t || [...e.t].length > 22) errs.push(`${at}：標題長度`);
      if (!e.d || [...e.d].length < 15 || [...e.d].length > 160) errs.push(`${at}：說明長度`);
      const dup = `${e.y}|${e.t}`;
      if (seen.has(dup)) errs.push(`${at}：與 ${seen.get(dup)} 重複`);
      seen.set(dup, key);
    }
  }
}

console.log(`共 ${total} 則（${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('、')}），少於 2 則的日子：${thin} 天`);
if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
console.log('格式檢查通過');
