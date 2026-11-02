// 縣市基礎資料：人口（萬人，約 2025 年）與財富相對差異（依可支配所得概略設定）
export interface CountyBase { pop: number; wealthOffset: number }

export const COUNTY_BASE: Record<string, CountyBase> = {
  新北市: { pop: 404, wealthOffset: 3 },
  台中市: { pop: 285, wealthOffset: 2 },
  高雄市: { pop: 272, wealthOffset: 0 },
  台北市: { pop: 247, wealthOffset: 15 },
  桃園市: { pop: 233, wealthOffset: 3 },
  台南市: { pop: 184, wealthOffset: -2 },
  彰化縣: { pop: 122, wealthOffset: -4 },
  屏東縣: { pop: 79, wealthOffset: -7 },
  雲林縣: { pop: 66, wealthOffset: -8 },
  新竹縣: { pop: 59, wealthOffset: 8 },
  苗栗縣: { pop: 53, wealthOffset: -3 },
  嘉義縣: { pop: 48, wealthOffset: -8 },
  南投縣: { pop: 47, wealthOffset: -7 },
  新竹市: { pop: 46, wealthOffset: 12 },
  宜蘭縣: { pop: 45, wealthOffset: -3 },
  基隆市: { pop: 36, wealthOffset: -2 },
  花蓮縣: { pop: 32, wealthOffset: -5 },
  嘉義市: { pop: 26, wealthOffset: -1 },
  台東縣: { pop: 21, wealthOffset: -8 },
  金門縣: { pop: 14, wealthOffset: 0 },
  澎湖縣: { pop: 11, wealthOffset: -4 },
  連江縣: { pop: 1.4, wealthOffset: 2 },
};

/** 離島沒有陸地相鄰，補上海上連結讓民意可以擴散 */
export const SEA_LINKS: [string, string][] = [
  ['澎湖縣', '雲林縣'], ['澎湖縣', '嘉義縣'], ['澎湖縣', '台南市'], ['澎湖縣', '高雄市'],
  ['金門縣', '連江縣'], ['連江縣', '基隆市'],
];

/** 命名地點（海域、對岸等）：經緯度與顯示名稱 */
export const NAMED_POINTS: Record<string, { lon: number; lat: number; label: string; zoom: number }> = {
  strait: { lon: 119.8, lat: 24.2, label: '台灣海峽', zoom: 520 },
  east: { lon: 122.6, lat: 23.6, label: '台灣以東海域', zoom: 520 },
  north: { lon: 122.4, lat: 26.2, label: '東海', zoom: 560 },
  south: { lon: 121.0, lat: 21.4, label: '巴士海峽', zoom: 520 },
  mainland: { lon: 118.6, lat: 24.9, label: '對岸沿海', zoom: 520 },
  pacific: { lon: 124.4, lat: 22.6, label: '西太平洋', zoom: 640 },
  world: { lon: 121.0, lat: 23.7, label: '國際', zoom: 900 },
};
