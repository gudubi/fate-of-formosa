import geo from '../data/map/geo.json';
import rasterMeta from '../data/map/raster.json';
import { RASTER, RW, RH, GRID, GW, GH, HEIGHT_SCALE } from './terrain';

export { RASTER, RW, RH, GRID, GW, GH };

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

export interface Raster {
  /** 每像素縣市編號（0 = 海），RW × RH */
  ids: Uint8Array;
  /** 地形高度網格（公尺），GW × GH，間距 GRID 公里 */
  heights: Float32Array;
  /** 各縣市標籤位置（離邊界最遠的點） */
  labels: { x: number; y: number }[];
}

/**
 * 讀取建置時預先算好的灰階 PNG（tools/prepare-map.ts 產生：8 位元灰階、每列濾波 none）。
 * 直接解壓縮 IDAT，不經過圖片解碼與色彩管理，背景分頁也能載入且數值不會被改動。
 */
async function loadGray(url: string, w: number, h: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return loadGrayViaImage(url, w, h);
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const dv = new DataView(buf.buffer);
  const parts: ArrayBuffer[] = [];
  for (let o = 8; o < buf.length;) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    if (type === 'IDAT') parts.push(buf.buffer.slice(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w);
  return out;
}

async function loadGrayViaImage(url: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

export async function loadRaster(): Promise<Raster> {
  const base = import.meta.env.BASE_URL;
  const [ids, h8] = await Promise.all([
    loadGray(`${base}map/ids.png`, RW, RH),
    loadGray(`${base}map/height.png`, GW, GH),
  ]);
  const heights = new Float32Array(h8.length);
  for (let i = 0; i < h8.length; i++) heights[i] = h8[i] * HEIGHT_SCALE;
  return { ids, heights, labels: rasterMeta.labels };
}

/** 平面座標 → 縣市編號（0 = 海） */
export function rasterAt(r: Raster, x: number, y: number): number {
  const px = Math.floor((x - RASTER.x0) / RASTER.res), py = Math.floor((y - RASTER.y0) / RASTER.res);
  if (px < 0 || py < 0 || px >= RW || py >= RH) return 0;
  return r.ids[py * RW + px];
}

/** 平面座標的海拔高度（公尺），雙線性內插 */
export function heightAt(r: Raster, x: number, y: number): number {
  const gx = (x - RASTER.x0) / GRID, gy = (y - RASTER.y0) / GRID;
  if (gx < 0 || gy < 0 || gx >= GW - 1 || gy >= GH - 1) return 0;
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
  const H = r.heights, k = j * GW + i;
  return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) + (H[k + GW] * (1 - fx) + H[k + GW + 1] * fx) * fy;
}
