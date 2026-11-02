// 無畫面批次模擬：檢查結局分布、數值走向、事件頻率，並比較不同玩法的分數
// 執行：npx tsx tools/simulate.ts [局數]
// 中立性守門：「固定偏統」與「固定偏獨」兩種機器人的平均分數差距超過 2 分即警告
import { Engine, STAT_ORDER, type GameState } from '../src/sim/engine';
import type { EventDef, OptionDef } from '../src/sim/types';
import { validateEvents } from '../src/sim/validate';
import { ALL_EVENTS } from '../src/data/events';
import { COUNTIES } from '../src/map/mapData';

const errs = validateEvents(ALL_EVENTS);
if (errs.length) { console.log('資料錯誤：\n' + errs.join('\n')); process.exit(1); }

const N = Number(process.argv[2] ?? 300);
const EGGS_ONLY = process.argv.includes("--eggs");
const START = Date.UTC(2026, 10, 2, 13, 0);

/** 機器人：回傳要干預的選項索引，或 null 交給自然命運 */
type Bot = (e: Engine, d: EventDef) => number | null;

const leanPush = (o: OptionDef) => (o.effects?.govLean ?? 0) + (o.effects?.popLean ?? 0) * 0.5;
const scoreGain = (o: OptionDef) => {
  const f = { ...o.effects };
  for (const [k, v] of Object.entries(o.over?.effects ?? {})) (f as any)[k] = ((f as any)[k] ?? 0) + (v as number);
  for (const p of o.policy ?? []) (f as any)[p.stat] = ((f as any)[p.stat] ?? 0) + p.shift * 0.5;
  return ((f.stability ?? 0) + (f.wealth ?? 0) + (f.gdp ?? 0) + (f.trust ?? 0) + (f.intl ?? 0)) / 5
    - (f.tension ?? 0) * 0.5 * (f.tension && f.tension > 0 ? 1 : 0.5) - (f.dep ?? 0) * 0.5 + (f.demo ?? 0) * 0.1;
};
const pickBy = (score: (o: OptionDef) => number, min: number): Bot => (e, d) => {
  const opts = d.options!;
  let best = -1, bestV = min;
  opts.forEach((o, i) => {
    const v = score(o);
    if (v > bestV && e.cost(d, i) <= e.s.divine) { best = i; bestV = v; }
  });
  return best < 0 ? null : best;
};

const BOTS: Record<string, Bot> = {
  不干預: () => null,
  貪婪: pickBy(scoreGain, 0.5),
  固定偏統: pickBy(o => -leanPush(o), 0.4),
  固定偏獨: pickBy(o => leanPush(o), 0.4),
};

function play(seed: number, bot: Bot, stats?: { tier: Record<string, number>; ev: Record<string, number>; decade?: number[] }) {
  const s: GameState = Engine.newGame(COUNTIES, seed, START);
  const e = new Engine(ALL_EVENTS, s);
  if (stats) {
    e.hooks.news = l => { stats.tier.news = (stats.tier.news ?? 0) + 1; stats.ev[l.eventId] = (stats.ev[l.eventId] ?? 0) + 1; };
    e.hooks.resolved = l => {
      stats.tier[l.tier] = (stats.tier[l.tier] ?? 0) + 1; stats.ev[l.eventId] = (stats.ev[l.eventId] ?? 0) + 1;
      if (stats.decade && l.tier === 'major' && !l.eventId.startsWith('sys_')) {
        const d = Math.min(2, Math.floor(l.day / 3652.5));
        stats.decade[d] = (stats.decade[d] ?? 0) + 1;
      }
    };
  }
  while (!s.ended) {
    // 玩家會處理所有待決事件（一般事件不倒數，因此逐一決定）
    for (const p of [...s.pending]) {
      const d = e.defs.get(p.eventId)!;
      const i = bot(e, d);
      if (i === null || !e.resolve(p.uid, i)) e.resolve(p.uid, null);
      if (s.ended) break;
    }
    if (!s.ended) e.tick();
  }
  return s;
}

const tierCount: Record<string, number> = {};
const decadeCount = [0, 0, 0];
const eventCount: Record<string, number> = {};
const endings: Record<string, number> = {};
const titles: Record<string, number> = {};
const finals: number[][] = [];
const eggHist: number[] = [];
const eggSeen: Record<string, number> = {};
let endYears = 0;
for (let g = 0; g < N; g++) {
  const s = play(1000 + g, BOTS.不干預, { tier: tierCount, ev: eventCount, decade: decadeCount });
  endings[s.ended!.id] = (endings[s.ended!.id] ?? 0) + 1;
  titles[s.ended!.title] = (titles[s.ended!.title] ?? 0) + 1;
  endYears += s.day / 365.25 / N;
  finals.push([...STAT_ORDER.map(k => s.stats[k]), s.hidden.dep]);
  const parentsOnly = s.eggs.filter(id => !ALL_EVENTS.find(d => d.id === id)?.chainOnly);
  eggHist[parentsOnly.length] = (eggHist[parentsOnly.length] ?? 0) + 1;
  for (const id of parentsOnly) eggSeen[id] = (eggSeen[id] ?? 0) + 1;
}

const pct = (n: number, d = N) => `${((n / d) * 100).toFixed(1)}%`;
console.log(`\n${N} 局（全程不干預），平均結束於第 ${endYears.toFixed(1)} 年`);
console.log('結局：', Object.entries(endings).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('稱號：', Object.entries(titles).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('每局事件數：', Object.entries(tierCount).map(([k, v]) => `${k} ${(v / N).toFixed(0)}`).join('  '));
console.log('隨機重大事件（不含選舉等系統事件）各十年：', decadeCount.map((v, i) => `第${i + 1}個十年 ${(v / N).toFixed(1)}`).join('  '));
console.log('\n數值         終局平均   終局標準差');
[...STAT_ORDER, 'dep'].forEach((k, i) => {
  const xs = finals.map(f => f[i]);
  const m = xs.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / N);
  console.log(`${k.padEnd(10)} ${m.toFixed(1).padStart(9)} ${sd.toFixed(1).padStart(11)}`);
});
const sorted = Object.entries(eventCount).sort((a, b) => b[1] - a[1]);
console.log('\n最常見事件：', sorted.slice(0, 10).map(([k, v]) => `${k}:${(v / N).toFixed(1)}`).join(' '));
const never = ALL_EVENTS.filter(d => !eventCount[d.id] && !d.egg).map(d => d.id);
console.log(`從未發生（${never.length}）：`, never.join(' '));

// ---- 彩蛋 ----
const eggDefs = ALL_EVENTS.filter(d => d.egg && !d.chainOnly);
const avgEggs = Object.entries(eggHist).reduce((a, [k, v]) => a + Number(k) * (v ?? 0), 0) / N;
console.log(`
彩蛋：每局平均 ${avgEggs.toFixed(2)} 個；分布 ` + [...eggHist.keys()].map(k => `${k} 個 ${pct(eggHist[k] ?? 0)}`).join('  '));
console.log('各彩蛋出現率：' + eggDefs.map(d => `${d.title.replaceAll('{county}', '')} ${pct(eggSeen[d.id] ?? 0)}`).join('、'));
const neverEgg = eggDefs.filter(d => !eggSeen[d.id]).map(d => d.id);
if (neverEgg.length) console.log('從未出現的彩蛋：', neverEgg.join(' '));

if (EGGS_ONLY) process.exit(0);

// ---- 玩法比較 ----
const M = Math.max(60, Math.round(N / 2));
console.log(`\n玩法比較（各 ${M} 局，同一組種子）`);
const botScore: Record<string, number> = {};
for (const [name, bot] of Object.entries(BOTS)) {
  let sum = 0, early = 0;
  const end: Record<string, number> = {};
  for (let g = 0; g < M; g++) {
    const s = play(5000 + g, bot);
    sum += s.ended!.score;
    end[s.ended!.id] = (end[s.ended!.id] ?? 0) + 1;
    if (s.ended!.id !== 'timeup') early++;
  }
  botScore[name] = sum / M;
  console.log(`${name.padEnd(5, '　')} 平均分數 ${(sum / M).toFixed(1)}  提前結束 ${pct(early, M)}  `
    + Object.entries(end).map(([k, v]) => `${k}:${v}`).join(' '));
}
const diff = Math.abs(botScore.固定偏統 - botScore.固定偏獨);
console.log(diff > 2 ? `\n⚠ 偏統與偏獨分數差距 ${diff.toFixed(1)} 分，超過 2 分` : `\n✓ 偏統與偏獨分數差距 ${diff.toFixed(1)} 分`);
