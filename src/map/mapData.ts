import geo from '../data/map/geo.json';
import { lonLatToKm } from './projection';

export interface CountyGeo {
  id: string;
  name: string;
  eng: string;
  /** 多邊形 → 環（第一個為外環，其餘為洞）→ 點 [x, y]（公里，y 向南） */
  polygons: number[][][][];
  neighbors: string[];
}

export interface GeoData {
  counties: CountyGeo[];
  borders: number[][][];
  coast: number[][][];
  neighbors: { name: string; rings: number[][][] }[];
  graticule: number[][][];
}

export const GEO = geo as unknown as GeoData;

/** 縣市（依 GEO.counties 順序，id 編號 1…22；0 = 海） */
export const COUNTIES = GEO.counties.map(c => ({
  name: c.name,
  neighbors: c.neighbors.map(id => GEO.counties.find(x => x.id === id)!.name),
}));

// ---- 縣市 ID 柵格：0.25 公里／像素，涵蓋台澎金馬 ----
export const RASTER = { x0: -300, y0: -310, x1: 110, y1: 210, res: 0.25 };
export const RW = Math.round((RASTER.x1 - RASTER.x0) / RASTER.res);
export const RH = Math.round((RASTER.y1 - RASTER.y0) / RASTER.res);

export interface Raster {
  /** 每像素縣市編號（0 = 海） */
  ids: Uint8Array;
  /** 每像素距離海岸（公里） */
  seaDist: Float32Array;
  /** 各縣市標籤位置（離邊界最遠的點） */
  labels: { x: number; y: number }[];
}

function drawRings(ctx: CanvasRenderingContext2D, polys: number[][][][]) {
  ctx.beginPath();
  for (const poly of polys) for (const ring of poly) {
    ring.forEach(([x, y], i) => {
      const px = (x - RASTER.x0) / RASTER.res, py = (y - RASTER.y0) / RASTER.res;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');
}

/** 逐縣市繪製並以 alpha 判定，避免反鋸齒混色造成錯誤編號 */
export function buildRaster(): Raster {
  const ids = new Uint8Array(RW * RH);
  const cv = document.createElement('canvas');
  cv.width = RW; cv.height = RH;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  GEO.counties.forEach((c, i) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of c.polygons) for (const [x, y] of p[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const bx = Math.max(0, Math.floor((minX - RASTER.x0) / RASTER.res) - 2);
    const by = Math.max(0, Math.floor((minY - RASTER.y0) / RASTER.res) - 2);
    const bw = Math.min(RW - bx, Math.ceil((maxX - minX) / RASTER.res) + 5);
    const bh = Math.min(RH - by, Math.ceil((maxY - minY) / RASTER.res) + 5);
    ctx.clearRect(bx, by, bw, bh);
    ctx.fillStyle = '#fff';
    drawRings(ctx, c.polygons);
    const img = ctx.getImageData(bx, by, bw, bh).data;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      // 只要有覆蓋就算：避免相鄰縣市交界留下未填的「海」像素
      if (img[(y * bw + x) * 4 + 3] > 0) ids[(by + y) * RW + bx + x] = i + 1;
    }
    ctx.clearRect(bx, by, bw, bh);
  });

  // 距離轉換（chamfer 3-4）：到海的距離、到縣市邊界的距離
  const seaDist = chamfer(ids, (i, j) => ids[j] === 0 && ids[i] !== 0);
  const edgeDist = chamfer(ids, (i, j) => ids[j] !== ids[i]);
  const labels = GEO.counties.map(() => ({ x: 0, y: 0, d: -1 }));
  for (let y = 0; y < RH; y += 2) for (let x = 0; x < RW; x += 2) {
    const i = y * RW + x, id = ids[i];
    if (!id) continue;
    const l = labels[id - 1];
    if (edgeDist[i] > l.d) { l.d = edgeDist[i]; l.x = RASTER.x0 + x * RASTER.res; l.y = RASTER.y0 + y * RASTER.res; }
  }
  return { ids, seaDist, labels };
}

/** seed(i, j)：像素 i 與相鄰像素 j 構成邊界時為 true。回傳每像素到最近邊界的公里數 */
function chamfer(ids: Uint8Array, seed: (i: number, j: number) => boolean): Float32Array {
  const d = new Float32Array(RW * RH).fill(1e9);
  for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) {
    const i = y * RW + x;
    if (seed(i, i - 1) || seed(i, i + 1) || seed(i, i - RW) || seed(i, i + RW)) d[i] = 0;
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

export function rasterAt(r: Raster, x: number, y: number): { id: number; sea: number } {
  const px = Math.floor((x - RASTER.x0) / RASTER.res), py = Math.floor((y - RASTER.y0) / RASTER.res);
  if (px < 0 || py < 0 || px >= RW || py >= RH) return { id: 0, sea: 0 };
  const i = py * RW + px;
  return { id: r.ids[i], sea: r.seaDist[i] };
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

/** 平面座標的海拔高度（公尺） */
export function elevation(r: Raster, x: number, y: number): number {
  const { id, sea } = rasterAt(r, x, y);
  if (!id) return 0;
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
