import { geoTransverseMercator } from 'd3-geo';

/** 地球半徑（公里）：投影 scale 設為此值，輸出座標即為公里 */
const EARTH_R = 6371;

/** 以東經 121°、北緯 23.7° 為中心的橫麥卡托投影，1 單位 = 1 公里（x 向東、y 向南） */
export function makeProjection() {
  return geoTransverseMercator()
    .rotate([-121, -23.7])
    .scale(EARTH_R)
    .translate([0, 0]);
}

const proj = makeProjection();

/** 經緯度 → 平面公里座標 [x, y]（y 向南） */
export function lonLatToKm(lon: number, lat: number): [number, number] {
  const p = proj([lon, lat])!;
  return [p[0], p[1]];
}

/** 地圖可視範圍（公里）：約東經 116–126°、北緯 20.5–28° */
export const MAP_EXTENT: [[number, number], [number, number]] = [[-520, -480], [520, 360]];
