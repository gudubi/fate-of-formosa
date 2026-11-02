// 無畫面批次模擬：不干預地跑 N 局，檢查結局分布、數值走向與事件頻率
// 執行：npx tsx tools/simulate.ts [局數]
import { Engine, STAT_ORDER } from '../src/sim/engine';
import { validateEvents } from '../src/sim/validate';
import { ALL_EVENTS } from '../src/data/events';
import { COUNTIES } from '../src/map/mapData';

const errs = validateEvents(ALL_EVENTS);
if (errs.length) { console.log('資料錯誤：\n' + errs.join('\n')); process.exit(1); }

const N = Number(process.argv[2] ?? 300);
const endings: Record<string, number> = {};
const titles: Record<string, number> = {};
const tierCount: Record<string, number> = {};
const eventCount: Record<string, number> = {};
const finals: number[][] = [];
const mins: number[] = STAT_ORDER.map(() => 0);
const maxs: number[] = STAT_ORDER.map(() => 0);
let endYears = 0;

for (let g = 0; g < N; g++) {
  const s = Engine.newGame(COUNTIES, 1000 + g, Date.UTC(2026, 10, 2, 13, 0));
  const e = new Engine(ALL_EVENTS, s);
  e.hooks.news = l => { tierCount.news = (tierCount.news ?? 0) + 1; eventCount[l.eventId] = (eventCount[l.eventId] ?? 0) + 1; };
  e.hooks.resolved = l => { tierCount[l.tier] = (tierCount[l.tier] ?? 0) + 1; eventCount[l.eventId] = (eventCount[l.eventId] ?? 0) + 1; };
  const lo = STAT_ORDER.map(k => s.stats[k]), hi = [...lo];
  while (!s.ended) {
    const b = e.blocking();
    if (b) e.resolve(b.uid, null);
    else e.tick();
    STAT_ORDER.forEach((k, i) => { lo[i] = Math.min(lo[i], s.stats[k]); hi[i] = Math.max(hi[i], s.stats[k]); });
  }
  STAT_ORDER.forEach((_, i) => { mins[i] += lo[i] / N; maxs[i] += hi[i] / N; });
  endings[s.ended!.id] = (endings[s.ended!.id] ?? 0) + 1;
  titles[s.ended!.title] = (titles[s.ended!.title] ?? 0) + 1;
  endYears += s.day / 365.25 / N;
  finals.push(STAT_ORDER.map(k => s.stats[k]));
}

const pct = (n: number) => `${((n / N) * 100).toFixed(1)}%`;
console.log(`\n${N} 局（全程不干預），平均結束於第 ${endYears.toFixed(1)} 年`);
console.log('結局：', Object.entries(endings).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('稱號：', Object.entries(titles).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('每局事件數：', Object.entries(tierCount).map(([k, v]) => `${k} ${(v / N).toFixed(0)}`).join('  '));
console.log('\n數值         終局平均   終局標準差   局內最低均   局內最高均');
STAT_ORDER.forEach((k, i) => {
  const xs = finals.map(f => f[i]);
  const m = xs.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / N);
  console.log(`${k.padEnd(10)} ${m.toFixed(1).padStart(9)} ${sd.toFixed(1).padStart(11)} ${mins[i].toFixed(1).padStart(11)} ${maxs[i].toFixed(1).padStart(11)}`);
});
const sorted = Object.entries(eventCount).sort((a, b) => b[1] - a[1]);
console.log('\n最常見事件：', sorted.slice(0, 12).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join(' '));
const never = ALL_EVENTS.filter(d => !eventCount[d.id]).map(d => d.id);
console.log(`從未發生（${never.length}）：`, never.join(' '));
