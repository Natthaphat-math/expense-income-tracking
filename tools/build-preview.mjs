// สร้างไฟล์พรีวิวไฟล์เดียว สำหรับเปิดดูผ่านลิงก์ Artifact บน claude.ai
//
//   npm run preview -- <ไฟล์ปลายทาง>      (ค่าเริ่มต้น dist/preview.html)
//
// ต่างจากแอปจริงตรงนี้เท่านั้น:
// - ใช้ข้อมูลตัวอย่าง (tools/demo-data.js) ไม่แตะข้อมูลจริงหรือ Firestore
// - ปิดการซิงก์ และไม่ลงทะเบียน service worker (กรอบของพรีวิวไม่อนุญาต)
// - ปุ่มส่งออกไฟล์บอกว่าใช้ในพรีวิวไม่ได้ แทนที่จะกดแล้วเงียบ
// - ตัวอ่านสลิปเป็นตัวจำลอง (tools/preview-slip-reader.js) ให้ลองขั้นตอนตรวจและกันซ้ำได้
// - รวม JS/CSS ทั้งหมดไว้ในไฟล์เดียว เพราะพรีวิวโหลดไฟล์จากที่อื่นไม่ได้
// ไฟล์ที่ได้ห้าม commit (อยู่ใน .gitignore) และห้ามวางบน GitHub Pages
// เพราะ Pages ใช้ origin เดียวกับแอปจริง

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist/preview.html'));

// แก้โค้ดเฉพาะในพรีวิว — ทุกจุดต้องเจอจริง ไม่งั้นหยุด build
// (ถ้าโค้ดแอปเปลี่ยนจนจุดนี้หาย ต้องรู้ทันที ไม่ใช่ได้พรีวิวที่ซิงก์ข้อมูลจริง)
const PATCHES = {
  'js/firebase-config.js': [['export const SYNC_ENABLED = true;', 'export const SYNC_ENABLED = false;']],
  'js/main.js': [['\n  registerServiceWorker();\n', '\n']],
  'js/screens/settings.js': [[
    '  async function exportData() {\n',
    "  async function exportData() {\n    toast('การส่งออกไฟล์ใช้ได้ในแอปจริง ไม่ใช่ในพรีวิว');\n    return;\n",
  ]],
};

const patchPlugin = {
  name: 'preview-patches',
  setup(build) {
    // ตัวอ่านสลิปจริงโหลดไฟล์จาก vendor/ ซึ่งพรีวิวไฟล์เดียวไม่มี — ใช้ตัวจำลองแทน
    build.onResolve({ filter: /slip-reader\.js$/ }, () => ({
      path: path.join(ROOT, 'tools/preview-slip-reader.js'),
    }));
    build.onLoad({ filter: /\.js$/ }, (args) => {
      const rel = path.relative(ROOT, args.path).split(path.sep).join('/');
      const patches = PATCHES[rel];
      if (!patches) return null;
      let code = fs.readFileSync(args.path, 'utf8');
      for (const [from, to] of patches) {
        if (!code.includes(from)) throw new Error(`preview patch not found in ${rel}: ${JSON.stringify(from)}`);
        code = code.replace(from, to);
      }
      return { contents: code, loader: 'js' };
    });
  },
};

const PREVIEW_CSS = `
/* ── เฉพาะพรีวิว ─────────────────────────────────────────────────────
   :root ของหน้าพรีวิวเว้นขอบบน/ล่างตาม safe area ให้แล้ว จึงไม่ต้องเว้นซ้ำ
   และเว้นที่ให้แถบ "ข้อมูลตัวอย่าง" ด้านบน */
.app-root { padding-top: 44px; }
.demo-strip {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: env(safe-area-inset-top, 0px) calc(4px + env(safe-area-inset-right, 0px)) 0 calc(16px + env(safe-area-inset-left, 0px));
  background: #fdf6e9;
  border-bottom: 1px solid #ecdcb9;
}
.demo-strip-text { font-size: 14px; font-weight: 600; color: var(--warn); }
.demo-strip-reset {
  min-height: 44px; min-width: 44px;
  padding: 0 12px;
  font-size: 14px; font-weight: 600;
  color: var(--warn);
  text-decoration: underline;
  text-underline-offset: 3px;
}
`;

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'tools/preview-entry.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  logLevel: 'warning',
  plugins: [patchPlugin],
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// ฟอนต์ฝังเป็น data URI — พรีวิวโหลดไฟล์ข้าง ๆ ไม่ได้
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')
  .replace(/url\("\.\/(fonts\/[a-z0-9-]+\.woff2)"\)/g, (_, file) => {
    const data = fs.readFileSync(path.join(ROOT, file)).toString('base64');
    return `url("data:font/woff2;base64,${data}")`;
  }) + PREVIEW_CSS;
if (css.includes('./fonts/')) throw new Error('font url not inlined');

// หน้าพรีวิวถูกห่อด้วย <html><head><body> ตอนเผยแพร่ จึงเขียนแค่เนื้อหา
const html = `<title>รายรับรายจ่าย</title>
<style>
${css}
</style>
<div id="app" class="app-root"></div>
<nav id="bottom-bar" class="bottom-bar" aria-label="เมนูหลัก"></nav>
<script>
${js}
</script>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`preview: ${OUT} (${(html.length / 1024).toFixed(0)} KB)`);
