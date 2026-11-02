// 預處理地圖：把縣市界線與周邊國家投影成公里座標，輸出 src/data/map/geo.json
// 執行：npx tsx tools/prepare-map.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { geoPath, geoGraticule } from 'd3-geo';
import { feature, mesh, neighbors } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { makeProjection, MAP_EXTENT } from '../src/map/projection';

const tw = JSON.parse(readFileSync('node_modules/taiwan-atlas/counties-10t.json', 'utf8')) as Topology;
const world = JSON.parse(readFileSync('node_modules/world-atlas/countries-10m.json', 'utf8')) as Topology;

const proj = makeProjection();
const r1 = (n: number) => Math.round(n * 100) / 100;
const P = (c: number[]) => { const p = proj(c as [number, number])!; return [r1(p[0]), r1(p[1])]; };

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

// 縣市內部界線與海岸線
const lineString = (g: any) => (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]).map((l: number[][]) => l.map(P));
const borders = lineString(mesh(tw, countiesObj, (a, b) => a !== b));
const coast = lineString(mesh(tw, countiesObj, (a, b) => a === b));

// ---- 周邊國家（裁切到地圖範圍） ----
const [[x0, y0], [x1, y1]] = MAP_EXTENT;
const clipProj = makeProjection().clipExtent([[x0 - 5, y0 - 5], [x1 + 5, y1 + 5]]);
const worldFc = feature(world, world.objects.countries as GeometryCollection) as unknown as { features: Feature<any, any>[] };
const NEIGHBOR_IDS: Record<string, string> = { '156': '中國', '392': '日本', '608': '菲律賓', '344': '香港' };
const neighborsOut: { name: string; rings: number[][][] }[] = [];
for (const f of worldFc.features) {
  const name = NEIGHBOR_IDS[String(f.id)];
  if (!name) continue;
  const rings: number[][][] = [];
  let cur: number[][] = [];
  const ctx = {
    moveTo(x: number, y: number) { cur = [[r1(x), r1(y)]]; },
    lineTo(x: number, y: number) { cur.push([r1(x), r1(y)]); },
    closePath() { if (cur.length > 2) rings.push(cur); cur = []; },
    arc() {}, beginPath() {},
  };
  geoPath(clipProj, ctx as any)(f);
  // 濾掉極小的島嶼碎片
  const area = (r: number[][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const kept = rings.filter(r => area(r) > 0.8);
  if (kept.length) neighborsOut.push({ name, rings: kept });
}

// ---- 經緯線 ----
const grat = geoGraticule().step([1, 1]).extent([[112, 17], [130, 31]]).lines()
  .map(l => l.coordinates.map(P));

mkdirSync('src/data/map', { recursive: true });
writeFileSync('src/data/map/geo.json', JSON.stringify({ counties, borders, coast, neighbors: neighborsOut, graticule: grat }));
console.log('counties', counties.length, 'borders', borders.length, 'neighbor rings', neighborsOut.map(n => `${n.name}:${n.rings.length}`).join(' '));
