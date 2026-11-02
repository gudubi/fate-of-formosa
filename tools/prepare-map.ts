// 預處理地圖（執行：npx tsx tools/prepare-map.ts）
//   src/data/map/geo.json    縣市多邊形、界線、周邊國家、經緯線（公里座標）
//   src/data/map/raster.json 柵格尺寸與縣市標籤位置
//   public/map/ids.png       縣市編號柵格（8 位元灰階）
//   public/map/height.png    地形高度網格（8 位元灰階，每單位 HEIGHT_SCALE 公尺）
// 柵格與地形在建置時算好，遊戲啟動時不必再於主執行緒計算
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { geoPath, geoGraticule } from 'd3-geo';
import { feature, mesh, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { makeProjection, MAP_EXTENT } from '../src/map/projection';
import { rasterize, labelPoints, heightGrid, RW, RH, GW, GH, HEIGHT_SCALE } from '../src/map/terrain';

const tw = JSON.parse(readFileSync('node_modules/taiwan-atlas/counties-10t.json', 'utf8')) as Topology;
const world = JSON.parse(readFileSync('node_modules/world-atlas/countries-10m.json', 'utf8')) as Topology;

const proj = makeProjection();
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const P = (c: number[]) => { const p = proj(c as [number, number])!; return [r2(p[0]), r2(p[1])]; };

/** Ramer–Douglas–Peucker 簡化（tol 公里） */
function simplify(pts: number[][], tol: number): number[][] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const round1 = (ring: number[][]) => ring.map(([x, y]) => [r1(x), r1(y)]);

// ---- 縣市 ----
const countiesObj = tw.objects.counties as GeometryCollection;
const fc = feature(tw, countiesObj) as unknown as { features: Feature<Polygon | MultiPolygon, any>[] };
const nb = neighbors(countiesObj.geometries as any);
const counties = fc.features.map((f, i) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return {
    id: f.properties.COUNTYID as string,
    name: f.properties.COUNTYNAME as string,
    eng: f.properties.COUNTYENG as string,
    polygons: polys.map(rings => rings.map(ring => ring.map(P))),
    neighbors: nb[i].map(j => fc.features[j].properties.COUNTYID as string),
  };
});

// ---- 柵格、標籤、地形（使用完整精度的多邊形） ----
const ids = rasterize(counties);
const labels = labelPoints(ids, counties.length);
const heights = heightGrid(ids);
const h8 = new Uint8Array(GW * GH);
for (let i = 0; i < h8.length; i++) h8[i] = Math.min(255, Math.round(heights[i] / HEIGHT_SCALE));

// 縣市界線與海岸線
const lineString = (g: any) => (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]).map((l: number[][]) => round1(l.map(P)));
const borders = lineString(mesh(tw, countiesObj, (a, b) => a !== b));
const coast = lineString(mesh(tw, countiesObj, (a, b) => a === b));

// ---- 周邊國家（裁切到地圖範圍並簡化） ----
const [[x0, y0], [x1, y1]] = MAP_EXTENT;
const clipProj = makeProjection().clipExtent([[x0 - 5, y0 - 5], [x1 + 5, y1 + 5]]);
const worldFc = feature(world, world.objects.countries as GeometryCollection) as unknown as { features: Feature<any, any>[] };
const NEIGHBOR_IDS: Record<string, string> = { '156': '中國', '392': '日本', '608': '菲律賓', '344': '香港' };
const neighborsOut: { name: string; rings: number[][][] }[] = [];
const area = (r: number[][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
for (const f of worldFc.features) {
  const name = NEIGHBOR_IDS[String(f.id)];
  if (!name) continue;
  const rings: number[][][] = [];
  let cur: number[][] = [];
  const ctx = {
    moveTo(x: number, y: number) { cur = [[x, y]]; },
    lineTo(x: number, y: number) { cur.push([x, y]); },
    closePath() { if (cur.length > 2) rings.push(cur); cur = []; },
    arc() {}, beginPath() {},
  };
  geoPath(clipProj, ctx as any)(f);
  const kept = rings.filter(r => area(r) > 0.8).map(r => round1(simplify(r, 0.35))).filter(r => r.length > 3);
  if (kept.length) neighborsOut.push({ name, rings: kept });
}

const grat = geoGraticule().step([1, 1]).extent([[112, 17], [130, 31]]).lines().map(l => l.coordinates.map(P));

// 縣市多邊形只用於海岸峭壁，精度 0.1 公里已足夠
const countiesOut = counties.map(c => ({ ...c, polygons: c.polygons.map(p => p.map(r => round1(simplify(r, 0.05)))) }));

mkdirSync('src/data/map', { recursive: true });
mkdirSync('public/map', { recursive: true });
writeFileSync('src/data/map/geo.json', JSON.stringify({ counties: countiesOut, borders, coast, neighbors: neighborsOut, graticule: grat }));
writeFileSync('src/data/map/raster.json', JSON.stringify({ RW, RH, GW, GH, HEIGHT_SCALE, labels }));
writeFileSync('public/map/ids.png', grayPng(ids, RW, RH));
writeFileSync('public/map/height.png', grayPng(h8, GW, GH));
console.log('counties', counties.length, 'raster', RW, 'x', RH, 'grid', GW, 'x', GH,
  'neighbor rings', neighborsOut.map(n => `${n.name}:${n.rings.length}`).join(' '));

// ---- 最小 PNG 編碼器（8 位元灰階） ----
function grayPng(data: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // 濾波：none
    raw.set(data.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb) >>> 0);
  return Buffer.concat([len, tb, crc]);
}
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
