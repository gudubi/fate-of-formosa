// 把遊戲建置成網頁版，複製到網站的資料夾（例如 gudubi_home/public/games/fate-of-formosa）。
//   npm run publish:site -- <目標資料夾>
//   或先設環境變數 FOF_SITE_DIR，之後只要 npm run publish:site
// 目標資料夾裡原本的東西會先清掉，所以只接受「空的、不存在的、或上一次就是這個腳本放的（有 .fate_of_formosa 記號）」資料夾。
import { spawnSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdirSync, cpSync, writeFileSync, statSync } from 'node:fs';
import { resolve, parse } from 'node:path';

const target = process.argv[2] || process.env.FOF_SITE_DIR;
if (!target) {
  console.error('要給目標資料夾：npm run publish:site -- D:\\workspace\\gudubi\\gudubi_home\\public\\games\\fate-of-formosa');
  process.exit(1);
}
const dir = resolve(target);
if (parse(dir).root === dir) { console.error('不能放在磁碟根目錄：' + dir); process.exit(1); }
const MARK = '.fate_of_formosa';
if (existsSync(dir)) {
  if (!statSync(dir).isDirectory()) { console.error('目標不是資料夾：' + dir); process.exit(1); }
  const inside = readdirSync(dir);
  if (inside.length && !inside.includes(MARK)) {
    console.error(`目標資料夾裡已經有別的東西（沒有 ${MARK} 記號），不敢清：${dir}\n換一個空的資料夾，或確認以後自己清空。`);
    process.exit(1);
  }
}

console.log('型別檢查與建置（tsc ＋ vite build）…');
const r = spawnSync('npm run build', { stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status || 1);

if (existsSync(dir)) for (const f of readdirSync(dir)) rmSync(resolve(dir, f), { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync('dist', dir, { recursive: true });
let commit = '';
try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* 不在 git 裡也沒關係 */ }
writeFileSync(resolve(dir, MARK), `《命運之手：台灣》Fate of Formosa　網頁版\ncommit ${commit}\n${new Date().toISOString()}\n`);
const size = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).reduce((a, f) => a + size(resolve(p, f)), 0) : s.size; };
console.log(`完成：${dir}（${(size(dir) / 1048576).toFixed(1)} MB，commit ${commit}）`);
