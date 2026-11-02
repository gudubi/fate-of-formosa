// 本機最佳紀錄（只存在這台裝置的瀏覽器中）
const KEY = 'tgh-records-v1';

export interface RecordEntry {
  score: number;
  title: string;
  years: number;
  seed: number;
  survived: boolean;
  /** 結束時的真實日期（ISO 字串） */
  at: string;
  milestones: number;
}

export function loadRecords(): RecordEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecordEntry[]; } catch { return []; }
}

/** 新增一筆紀錄，回傳它在前 10 名中的名次（1 起算；未進榜為 0） */
export function addRecord(r: RecordEntry): number {
  const list = [...loadRecords(), r].sort((a, b) => b.score - a.score).slice(0, 10);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 無痕模式 */ }
  return list.indexOf(r) + 1;
}
