// สว่าง / มืด / ตามเครื่อง — ค่าเริ่มต้นคือสว่าง
// เก็บแยกแต่ละเครื่อง (ไม่ซิงก์) เพราะ iPhone กับ iPad อาจอยากตั้งไม่เหมือนกัน
// index.html มีสคริปต์สั้น ๆ อ่านค่าเดียวกันนี้ก่อนวาดหน้า เพื่อไม่ให้จอขาววาบตอนเปิด

export const THEME_KEY = 'tet:theme';
export const THEMES = [
  { id: 'light', label: 'สว่าง' },
  { id: 'dark', label: 'มืด' },
  { id: 'auto', label: 'ตามเครื่อง' },
];

const BAR_COLOR = { light: '#f5f6fa', dark: '#101217' };

export function getTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function setTheme(id) {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ใช้ได้แค่รอบนี้ */ }
  applyTheme(id);
}

/** โหมดที่แสดงอยู่จริง (auto แปลเป็น light/dark ตามเครื่อง) */
function resolved(id) {
  if (id !== 'auto') return id;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(id = getTheme()) {
  document.documentElement.dataset.theme = id;
  // สีแถบสถานะของ iOS ให้กลืนกับพื้นหลัง
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BAR_COLOR[resolved(id)]);
}

/** ถ้าเลือก "ตามเครื่อง" แล้วเครื่องสลับโหมดระหว่างเปิดแอป ให้เปลี่ยนตาม */
export function watchSystemTheme() {
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
}
