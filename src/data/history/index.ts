// 「歷史上的今天」資料：每月一個 JSON 檔（01.json … 12.json），依需要延遲載入
// 檔案格式：{ "MM-DD": HistoryEntry[] }

export type HistoryKind = 'event' | 'birth' | 'other';

export interface HistoryEntry {
  /** 西元年 */
  y: number;
  /** event = 大事件、birth = 名人誕辰、other = 其他值得記錄的事（文化、體育、科技、紀錄、逝世等） */
  k: HistoryKind;
  /** 標題（建議 ≤ 20 字），跑馬燈顯示 */
  t: string;
  /** 詳細說明（建議 40–120 字），點開後顯示 */
  d: string;
}

export type MonthData = Record<string, HistoryEntry[]>;

const loaders = import.meta.glob<{ default: MonthData }>('./*.json');
const cache = new Map<number, MonthData>();

/** 取得某月資料（month 為 1–12），沒有檔案時回傳空物件 */
export async function loadMonth(month: number): Promise<MonthData> {
  if (cache.has(month)) return cache.get(month)!;
  const key = `./${String(month).padStart(2, '0')}.json`;
  const data = loaders[key] ? (await loaders[key]()).default : {};
  cache.set(month, data);
  return data;
}

/** 取得某日（month 1–12、day 1–31）的條目，依年份排序 */
export async function entriesOn(month: number, day: number): Promise<HistoryEntry[]> {
  const data = await loadMonth(month);
  const k = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return [...(data[k] ?? [])].sort((a, b) => a.y - b.y);
}

/** 已載入的月份中同步查詢（跑馬燈用）；未載入時回傳 null 並觸發載入 */
export function entriesOnSync(month: number, day: number): HistoryEntry[] | null {
  const data = cache.get(month);
  if (!data) { void loadMonth(month); return null; }
  return data[`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`] ?? [];
}

export const KIND_LABEL: Record<HistoryKind, string> = { event: '大事', birth: '誕辰', other: '記事' };
