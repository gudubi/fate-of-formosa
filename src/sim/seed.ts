// 對局代碼：6 個好念好抄的字元（去掉 0/O、1/I/L 等易混淆字），對應到 32 位元種子
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

export function randomCode(): string {
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, v => ALPHABET[v % ALPHABET.length]).join('');
}

/** 統一大小寫並去掉空白；空字串表示未輸入 */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** 代碼 → 種子（FNV-1a）。任何字串都可以當代碼，相同代碼一定得到相同種子 */
export function codeToSeed(code: string): number {
  let h = 0x811c9dc5;
  for (const ch of normalizeCode(code)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}
