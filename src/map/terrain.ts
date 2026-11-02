// 地圖柵格與地形的純計算（不依賴 DOM），供建置工具預先算好後隨遊戲出貨
import { lonLatToKm } from './projection';

/** 縣市 ID 柵格：0.25 公里／像素，涵蓋台澎金馬 */
export const RASTER = { x0: -300, y0: -310, x1: 110, y1: 210, res: 0.25 };
export const RW = Math.round((RASTER.x1 - RASTER.x0) / RASTER.res);
export const RH = Math.round((RASTER.y1 - RASTER.y0) / RASTER.res);

/** 地形高度網格：1 公里間距，與柵格同範圍 */
export const GRID = 1;
export const GW = Math.ceil((RASTER.x1 - RASTER.x0) / GRID) + 1;
export const GH = Math.ceil((RASTER.y1 - RASTER.y0) / GRID) + 1;
/** 高度圖以 8 位元儲存：每單位 17 公尺（最高約 4,300 公尺） */
export const HEIGHT_SCALE = 17;

/**
 * 以掃描線在像素中心取樣填入縣市編號（1…N，0 = 海）。
 * 相鄰縣市共用同一條邊界，像素中心只會落在其中一邊，因此交界不會留下空隙。
 */
export function rasterize(counties: { polygons: number[][][][] }[]): Uint8Array {
  const ids = new Uint8Array(RW * RH);
  counties.forEach((c, ci) => {
    const rings = c.polygons.flat();
    let minY = Infinity, maxY = -Infinity;
    for (const r of rings) for (const [, y] of r) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const r0 = Math.max(0, Math.floor((minY - RASTER.y0) / RASTER.res));
    const r1 = Math.min(RH - 1, Math.ceil((maxY - RASTER.y0) / RASTER.res));
    const xs: number[] = [];
    for (let row = r0; row <= r1; row++) {
      const yc = RASTER.y0 + (row + 0.5) * RASTER.res;
      xs.length = 0;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xa, ya] = ring[j], [xb, yb] = ring[i];
          if ((ya > yc) !== (yb > yc)) xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - RASTER.x0) / RASTER.res - 0.5));
        const c1 = Math.min(RW - 1, Math.floor((xs[k + 1] - RASTER.x0) / RASTER.res - 0.5));
        for (let col = c0; col <= c1; col++) ids[row * RW + col] = ci + 1;
      }
    }
  });
  return ids;
}

/** 距離轉換（chamfer 3-4）：seedFn(i, j) 為 true 表示像素 i 與相鄰像素 j 之間是邊界。回傳公里 */
export function chamfer(seedFn: (i: number, j: number) => boolean): Float32Array {
  const d = new Float32Array(RW * RH).fill(1e9);
  for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
    const i = y * RW + x;
    if (seedFn(i, i - 1) || seedFn(i, i + 1) || seedFn(i, i - RW) || seedFn(i, i + RW)) d[i] = 0;
  }
  for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
    const i = y * RW + x;
    d[i] = Math.min(d[i], d[i - 1] + 3, d[i - RW] + 3, d[i - RW - 1] + 4, d[i - RW + 1] + 4);
  }
  for (let y = RH - 2; y > 0; y--) for (let x = RW - 2; x > 0; x--) {
    const i = y * RW + x;
    d[i] = Math.min(d[i], d[i + 1] + 3, d[i + RW] + 3, d[i + RW + 1] + 4, d[i + RW - 1] + 4);
  }
  for (let i = 0; i < d.length; i++) d[i] = (d[i] / 3) * RASTER.res;
  return d;
}

/** 各縣市標籤位置：離縣市邊界最遠的點 */
export function labelPoints(ids: Uint8Array, count: number): { x: number; y: number }[] {
  const edge = chamfer((i, j) => ids[j] !== ids[i]);
  const best = Array.from({ length: count }, () => ({ x: 0, y: 0, d: -1 }));
  for (let y = 0; y < RH; y += 2) for (let x = 0; x < RW; x += 2) {
    const i = y * RW + x, id = ids[i];
    if (!id) continue;
    const l = best[id - 1];
    if (edge[i] > l.d) { l.d = edge[i]; l.x = RASTER.x0 + x * RASTER.res; l.y = RASTER.y0 + y * RASTER.res; }
  }
  return best.map(({ x, y }) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
}

// ---- 地形：以主要山脈稜線近似台灣真實地勢（公尺） ----
type Ridge = { pts: [number, number, number][]; sigma: number };
const RIDGES: Ridge[] = [
  { sigma: 13, pts: [ // 中央山脈
    [121.62, 24.58, 2300], [121.44, 24.36, 3740], [121.33, 24.10, 3550], [121.25, 23.85, 3250],
    [121.15, 23.62, 3350], [121.06, 23.47, 3800], [120.95, 23.25, 3650], [120.90, 22.95, 3250],
    [120.78, 22.62, 3050], [120.75, 22.30, 1500], [120.80, 22.03, 450]] },
  { sigma: 10, pts: [ // 雪山山脈
    [121.80, 24.98, 700], [121.58, 24.78, 1800], [121.38, 24.55, 3100], [121.23, 24.38, 3880],
    [121.10, 24.20, 2900], [120.96, 24.00, 2100], [120.86, 23.86, 1100]] },
  { sigma: 8, pts: [[121.02, 23.66, 2800], [120.96, 23.47, 3950], [120.92, 23.30, 3200]] }, // 玉山山脈
  { sigma: 8, pts: [[120.76, 23.78, 1500], [120.80, 23.51, 2600], [120.72, 23.20, 1800], [120.64, 22.95, 1100]] }, // 阿里山山脈
  { sigma: 5.5, pts: [ // 海岸山脈
    [121.55, 23.88, 700], [121.45, 23.50, 1500], [121.33, 23.20, 1650], [121.22, 22.95, 1000], [121.12, 22.78, 400]] },
  { sigma: 5, pts: [[121.50, 25.20, 900], [121.56, 25.17, 1120], [121.62, 25.13, 700]] }, // 大屯火山群
  { sigma: 9, pts: [[121.35, 24.85, 1400], [121.10, 24.62, 2100], [120.95, 24.45, 1200]] }, // 北部山地
  { sigma: 9, pts: [[120.85, 24.62, 500], [120.70, 24.30, 450], [120.62, 23.95, 300]] }, // 西部丘陵
];
const RIDGE_KM = RIDGES.map(r => ({ sigma: r.sigma, pts: r.pts.map(([lo, la, h]) => [...lonLatToKm(lo, la), h] as const) }));

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += amp * vnoise(x * f, y * f); f *= 2.1; amp *= 0.5; }
  return s;
}

/** 平面座標的海拔高度（公尺）；sea 為該點到海岸的距離（公里） */
export function ridgeElevation(x: number, y: number, sea: number): number {
  let h = 0;
  for (const ridge of RIDGE_KM) {
    const pts = ridge.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay, ah] = pts[i], [bx, by, bh] = pts[i + 1];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const qx = ax + dx * t - x, qy = ay + dy * t - y;
      const v = (ah + (bh - ah) * t) * Math.exp(-(qx * qx + qy * qy) / (2 * ridge.sigma * ridge.sigma));
      if (v > h) h = v;
    }
  }
  const n = fbm(x / 9, y / 9);
  h = h * (0.7 + 0.6 * n) + 40 * n;
  const coast = Math.min(1, sea / 5);
  return h * coast * coast * (3 - 2 * coast);
}

/** 預先計算整張高度網格（公尺） */
export function heightGrid(ids: Uint8Array): Float32Array {
  const sea = chamfer((i, j) => ids[j] === 0 && ids[i] !== 0);
  const out = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = RASTER.x0 + i * GRID, y = RASTER.y0 + j * GRID;
    const px = Math.min(RW - 1, Math.floor((x - RASTER.x0) / RASTER.res));
    const py = Math.min(RH - 1, Math.floor((y - RASTER.y0) / RASTER.res));
    const k = py * RW + px;
    out[j * GW + i] = ids[k] ? ridgeElevation(x, y, sea[k]) : 0;
  }
  return out;
}
