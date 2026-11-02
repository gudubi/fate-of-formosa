// 結局分享圖：1080×1350 直式卡片，可直接分享或下載
export interface ShareData {
  title: string;
  kicker: string;
  text: string;
  score: number;
  baseline: number | null;
  years: string;
  interventions: number;
  milestones: string[];
  stats: { label: string; value: string }[];
  code: string;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try { await img.decode(); return img; } catch { return null; }
}

export async function renderShareCard(d: ShareData, endingImg: string, icon: string): Promise<Blob> {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const font = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

  ctx.fillStyle = '#06111b';
  ctx.fillRect(0, 0, W, H);
  const art = await loadImage(endingImg);
  if (art) {
    const h = W * (art.height / art.width);
    ctx.drawImage(art, 0, 0, W, h);
    const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
    g.addColorStop(0, 'rgba(6,17,27,0)');
    g.addColorStop(1, 'rgba(6,17,27,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, h);
  }

  const x = 72;
  let y = 430;
  ctx.fillStyle = '#7fd6ff';
  ctx.font = `600 30px ${font}`;
  ctx.fillText(d.kicker, x, y);
  y += 110;
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 108px ${font}`;
  ctx.fillText(d.title, x, y);
  y += 70;
  ctx.fillStyle = '#c9d6e2';
  ctx.font = `400 32px ${font}`;
  for (const line of wrap(ctx, d.text, W - x * 2).slice(0, 4)) { ctx.fillText(line, x, y); y += 48; }

  // 分數列
  y += 30;
  const boxes: [string, string][] = [
    ['守護指數', String(d.score)],
    ['無人干預的平行世界', d.baseline === null ? '—' : String(d.baseline)],
    ['守護年數', d.years],
    ['出手干預', `${d.interventions} 次`],
  ];
  const bw = (W - x * 2 - 36) / 4;
  boxes.forEach(([k, v], i) => {
    const bx = x + i * (bw + 12);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(bx, y, bw, 130);
    ctx.fillStyle = '#8fa3b5';
    ctx.font = `400 22px ${font}`;
    ctx.fillText(k.length > 6 ? '平行世界' : k, bx + 18, y + 40);
    ctx.fillStyle = i === 0 ? '#ffd36b' : '#ffffff';
    ctx.font = `800 54px ${font}`;
    ctx.fillText(v, bx + 18, y + 105);
  });
  y += 170;

  // 數值
  ctx.font = `400 26px ${font}`;
  d.stats.forEach((s, i) => {
    const cx = x + (i % 3) * ((W - x * 2) / 3), cy = y + Math.floor(i / 3) * 52;
    ctx.fillStyle = '#8fa3b5';
    ctx.fillText(s.label, cx, cy);
    ctx.fillStyle = '#e6eef5';
    ctx.fillText(s.value, cx + 130, cy);
  });
  y += Math.ceil(d.stats.length / 3) * 52 + 20;

  if (d.milestones.length) {
    ctx.fillStyle = '#ffd36b';
    ctx.font = `600 26px ${font}`;
    for (const line of wrap(ctx, `里程碑：${d.milestones.join('、')}`, W - x * 2).slice(0, 2)) { ctx.fillText(line, x, y); y += 40; }
  }

  // 頁尾
  const ic = await loadImage(icon);
  if (ic) ctx.drawImage(ic, x, H - 140, 84, 84);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 40px ${font}`;
  ctx.fillText('命運之手：台灣', x + 104, H - 92);
  ctx.fillStyle = '#8fa3b5';
  ctx.font = `400 24px ${font}`;
  ctx.fillText(`種子碼 ${d.code}・gudubi.com`, x + 104, H - 56);

  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

/** 優先使用系統分享（手機），否則下載圖片 */
export async function shareOrDownload(blob: Blob, filename: string, text: string) {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text }); return; } catch { /* 使用者取消 */ return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
