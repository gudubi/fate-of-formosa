import * as THREE from 'three';
import type { Category, StatKey } from '../sim/types';

export interface StatMeta { label: string; lo: string; hi: string; lean?: boolean; danger?: 'low' | 'high'; short: string }

export const STAT_META: Record<StatKey, StatMeta> = {
  govLean: { label: '政府傾向', short: '政府', lo: '統一', hi: '獨立', lean: true },
  popLean: { label: '民眾傾向', short: '民眾', lo: '統一', hi: '獨立', lean: true },
  intl: { label: '國際看法', short: '國際', lo: '無所謂', hi: '重視' },
  gdp: { label: '國家經濟', short: '經濟', lo: '貧窮', hi: '富有', danger: 'low' },
  wealth: { label: '人民財富', short: '財富', lo: '貧窮', hi: '富有', danger: 'low' },
  stability: { label: '社會狀態', short: '安穩', lo: '動亂', hi: '安穩', danger: 'low' },
  tension: { label: '兩岸緊張', short: '緊張', lo: '和緩', hi: '戰爭邊緣', danger: 'high' },
  trust: { label: '政府信任', short: '信任', lo: '低', hi: '高' },
  defense: { label: '國防實力', short: '國防', lo: '弱', hi: '強' },
  tech: { label: '科技產業', short: '科技', lo: '弱', hi: '強' },
  demo: { label: '人口活力', short: '人口', lo: '老化', hi: '年輕' },
};

// 統獨軸刻意避開藍綠：統一端為紫、獨立端為琥珀，中間為淺灰
export const LEAN_NEG = '#9d6bd8';
export const LEAN_POS = '#e2a93b';
export const LEAN_MID = '#d9d5cd';

export interface CatMeta { label: string; color: string; icon: string }

// 圖示為 24×24 的 SVG path
export const CAT_META: Record<Category, CatMeta> = {
  disaster: { label: '天災', color: '#ff8a3d',
    icon: 'M2 13h4l2-6 3 12 3-9 2 3h6' },
  strait: { label: '兩岸', color: '#ff4d5e',
    icon: 'M3 9h13l-3-3M21 15H8l3 3' },
  politics: { label: '政治', color: '#b18cff',
    icon: 'M3 20h18M5 17V10M9.5 17V10M14.5 17V10M19 17V10M2.5 8 12 3l9.5 5z' },
  public: { label: '民意', color: '#ffd23f',
    icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6m-2.6-5.4A6 6 0 0 1 22 20' },
  intl: { label: '國際', color: '#3fd0ff',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z' },
  economy: { label: '經濟社會', color: '#f2d388',
    icon: 'M3 20h18M5 16l4-5 4 3 6-8M15 6h4v4' },
};

export const catColor = (c: Category) => new THREE.Color(CAT_META[c].color);

export function iconSvg(c: Category, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${CAT_META[c].icon}"/></svg>`;
}

export const HAND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/></svg>';

// ---- 地圖圖層配色 ----
export type LayerKey = 'terrain' | 'popLean' | 'stability' | 'wealth';
export const LAYERS: { key: LayerKey; label: string; lo: string; hi: string; colors: [string, string, string] }[] = [
  { key: 'terrain', label: '地形', lo: '', hi: '', colors: ['#5b7046', '#6b6450', '#cfcac0'] },
  { key: 'popLean', label: '民眾傾向', lo: '統一', hi: '獨立', colors: [LEAN_NEG, LEAN_MID, LEAN_POS] },
  { key: 'stability', label: '社會安穩', lo: '動亂', hi: '安穩', colors: ['#d1495b', '#e8dcc8', '#4fb0c6'] },
  { key: 'wealth', label: '人民財富', lo: '貧窮', hi: '富有', colors: ['#3b4a6b', '#9a8fb0', '#ffd166'] },
];

/** 三色漸層取色，t ∈ [0,1] */
export function ramp(colors: [string, string, string], t: number): THREE.Color {
  const a = new THREE.Color(colors[0]), b = new THREE.Color(colors[1]), c = new THREE.Color(colors[2]);
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? a.lerp(b, t * 2) : b.lerp(c, (t - 0.5) * 2);
}
