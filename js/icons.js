// ไอคอนเส้นแบบ SVG — เก็บเป็น <symbol> ชุดเดียวแล้วอ้างด้วย <use>
// ทุกเส้นใช้ currentColor จึงเปลี่ยนสีตามคลาสของกรอบได้

import { el, svgEl } from './dom.js';
import { UNCATEGORISED } from './model.js';

/** path ของแต่ละไอคอน (viewBox 0 0 24 24) — เป็นค่าคงที่ ไม่มีข้อมูลผู้ใช้ปน */
const PATHS = {
  bowl: ['M4 11h16a8 8 0 0 1-16 0z', 'M9 4c0 1.4 1 2 1 3.4M13.5 4c0 1.4 1 2 1 3.4'],
  fruit: ['M6 14.5C6 10 9 6.5 13 6.5c2.4 0 4 1.8 4 4.2 0 4.8-3.8 8.3-7.6 8.3C7.6 19 6 17.2 6 14.5z', 'M13 6.5c0-1.8 1.1-3 2.8-3.3'],
  question: ['M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6', 'M12 16.9v.1'],
  bus: ['M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M5 11h14M8.5 20l-1-3M15.5 20l1-3', 'M8.5 14h.01M15.5 14h.01'],
  cup: ['M6 8h11l-1.2 10.5a2 2 0 0 1-2 1.5H9.2a2 2 0 0 1-2-1.5z', 'M5 8h13M14 4l-1 4'],
  cake: ['M5 20h14v-6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z', 'M5 16c1.2 0 1.2 1 2.3 1s1.2-1 2.4-1 1.2 1 2.3 1 1.2-1 2.3-1 1.2 1 2.4 1 1.1-1 2.3-1', 'M12 12V8M12 5.5v-.01'],
  bolt: ['M13 3 5 13.5h6l-1 7.5 8-10.5h-6z'],
  droplet: ['M12 3.5c3 3.6 6 6.9 6 10.2a6 6 0 0 1-12 0c0-3.3 3-6.6 6-10.2z'],
  phone: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M11 18h2'],
  wifi: ['M3.5 9.5a12 12 0 0 1 17 0M6.5 12.7a7.6 7.6 0 0 1 11 0M9.5 15.9a3.4 3.4 0 0 1 5 0', 'M12 19h.01'],
  home: ['M4 11 12 4l8 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  repeat: ['M17 3l3 3-3 3', 'M4 11V9a3 3 0 0 1 3-3h13', 'M7 21l-3-3 3-3', 'M20 13v2a3 3 0 0 1-3 3H4'],
  basket: ['M4 10h16l-1.6 8.4a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6z', 'M8 10l3-6M16 10l-3-6', 'M10 14v2M14 14v2'],
  bag: ['M6 8h12l-1 12H7z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  gift: ['M4 10h16v3H4z', 'M5.5 13H18.5v7H5.5z', 'M12 10v10', 'M12 10C10 6 7 6 7.5 8.2 7.9 10 12 10 12 10zM12 10c2-4 5-4 4.5-1.8C16.1 10 12 10 12 10z'],
  pill: ['M10.5 4.5a4.2 4.2 0 0 1 6 6l-6 6a4.2 4.2 0 0 1-6-6z', 'M7.5 7.5l6 6'],
  heart: ['M12 19.5S4.5 15 4.5 9.6A3.8 3.8 0 0 1 12 7.8a3.8 3.8 0 0 1 7.5 1.8C19.5 15 12 19.5 12 19.5z'],
  suitcase: ['M5 8h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 8z', 'M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2', 'M8 8v11M16 8v11'],
  trend: ['M4 17l5-5 3.5 3.5L20 8', 'M15 8h5v5'],
  coin: ['M12 4.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15z', 'M12 8.5v7M10 10.2c0-.9.9-1.4 2-1.4s2 .5 2 1.3-1 1.2-2 1.4-2 .6-2 1.5.9 1.4 2 1.4 2-.5 2-1.4'],
  pie: ['M12 4a8 8 0 1 0 8 8h-8z', 'M14.5 3.6A8 8 0 0 1 20.4 9.5H14.5z'],
  cap: ['M3 9.5 12 5l9 4.5-9 4.5z', 'M7 11.5V16c1.5 1.4 3.2 2 5 2s3.5-.6 5-2v-4.5', 'M21 9.5V14'],
  book: ['M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z', 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3'],
  ticket: ['M4 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4z', 'M14 6v2M14 11v2M14 16v2'],
  shield: ['M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z', 'M9.5 12l1.8 1.8 3.4-3.6'],
  wallet: ['M5 6.5h12.5a1.5 1.5 0 0 1 1.5 1.5v1.5', 'M4 8a1.5 1.5 0 0 1 1.5-1.5M4 8v9.5A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H4z', 'M16 13.5h.01'],
  coins: ['M9 5c3 0 5 1 5 2.2S12 9.4 9 9.4 4 8.4 4 7.2 6 5 9 5z', 'M4 7.2v3.6c0 1.2 2 2.2 5 2.2s5-1 5-2.2V7.2', 'M4 10.8v3.6c0 1.2 2 2.2 5 2.2', 'M15 11c3 0 5 1 5 2.2s-2 2.2-5 2.2-5-1-5-2.2S12 11 15 11z', 'M10 13.2v3.6c0 1.2 2 2.2 5 2.2s5-1 5-2.2v-3.6'],
  spark: ['M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z', 'M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  piggy: ['M5.5 11.5C5.5 8.5 8.4 6.5 12 6.5s7 2 7 5.3c0 1.7-.8 3.1-2 4V19h-2.5v-1.6a9 9 0 0 1-4 0V19H8v-3.2a5.4 5.4 0 0 1-2-2.8H4.5v-3H6', 'M10 6.8a2.5 2.5 0 0 1 4.5-1.5', 'M15.5 11h.01'],
  receipt: ['M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z', 'M9 8h6M9 11.5h6M9 15h3.5'],
  tag: ['M4 12.6V5.5A1.5 1.5 0 0 1 5.5 4h7.1l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-6 6a1.5 1.5 0 0 1-2.1 0z', 'M8.5 8.5h.01'],
  sun: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'],
  moon: ['M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z'],
  calendar: ['M7 5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z', 'M4 10h16M9 3v4M15 3v4'],
  bars: ['M6 20v-8M12 20V5M18 20v-5'],
  sliders: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'],
  plus: ['M12 5v14M5 12h14'],
  chevronLeft: ['M14.5 6 8.5 12l6 6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  check: ['M5 12.5 10 17.5 19 7'],
  close: ['M6 6l12 12M18 6 6 18'],
  trash: ['M5 7h14M10 7V5h4v2', 'M7 7l1 13h8l1-13', 'M10.5 11v5.5M13.5 11v5.5'],
  pencil: ['M15.5 4.5l4 4L9 19H5v-4z', 'M13.5 6.5l4 4'],
  cloud: ['M7.5 18.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6 1.3A3.4 3.4 0 0 1 17 18.5z'],
  download: ['M12 4v10M8 10l4 4 4-4M5 19h14'],
  upload: ['M12 15V5M8 9l4-4 4 4M5 19h14'],
  image: ['M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z', 'M4.5 16l4.5-4.5 4 4 2.5-2.5 4 4', 'M15 8.5h.01'],
  share: ['M12 4v11', 'M8 8l4-4 4 4', 'M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12'],
  copy: ['M9 8h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 20H9a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 9 8z', 'M15.5 8V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H7.5'],
  list: ['M9 6h11M9 12h11M9 18h11', 'M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
};

const SPRITE_ID = 'icon-sprite';

/** ใส่ชุด symbol ไว้ท้าย body ครั้งเดียว (เรียกซ้ำได้ ไม่สร้างซ้ำ) */
export function ensureIconSprite() {
  if (document.getElementById(SPRITE_ID)) return;
  const sprite = svgEl('svg', {
    id: SPRITE_ID, width: 0, height: 0, 'aria-hidden': 'true',
    style: 'position:absolute;width:0;height:0;overflow:hidden',
  });
  for (const [name, paths] of Object.entries(PATHS)) {
    sprite.appendChild(svgEl('symbol', { id: `i-${name}`, viewBox: '0 0 24 24' },
      paths.map((d) => svgEl('path', { d }))));
  }
  document.body.appendChild(sprite);
}

/** ไอคอนหนึ่งตัว — ตกแต่งเท่านั้น ข้อความกำกับต้องอยู่ข้าง ๆ เสมอ */
export function icon(name, { size = 20, cls = '' } = {}) {
  const key = PATHS[name] ? name : 'tag';
  return svgEl('svg', {
    class: `icon ${cls}`.trim(), width: size, height: size, viewBox: '0 0 24 24',
    'aria-hidden': 'true', focusable: 'false',
  }, svgEl('use', { href: `#i-${key}` }));
}

/**
 * ไอคอนตามคำในชื่อประเภท — ใช้คำกลาง ๆ ที่พบบ่อย ไม่ผูกกับประเภทของใครคนใดคนหนึ่ง
 * เรียงจากคำที่เจาะจงไปคำที่กว้าง (เช่น "ผลไม้" ต้องมาก่อน "ไม้")
 * tone คือคู่สีพื้น/สีเส้นของกรอบ ดู .tone-* ใน styles.css
 */
const KEYWORDS = [
  [['ผลไม้'], 'fruit', 'green'],
  [['ของหวาน', 'ขนม', 'เบเกอรี่', 'เค้ก'], 'cake', 'pink'],
  [['เครื่องดื่ม', 'กาแฟ', 'ชา', 'น้ำหวาน', 'นม'], 'cup', 'purple'],
  [['อาหาร', 'ข้าว', 'กับข้าว', 'กิน'], 'bowl', 'orange'],
  [['เดินทาง', 'รถ', 'แท็กซี่', 'วิน', 'น้ำมัน', 'ทางด่วน', 'bts', 'mrt'], 'bus', 'blue'],
  [['ไฟ'], 'bolt', 'amber'],
  [['ประปา', 'ค่าน้ำ'], 'droplet', 'blue'],
  [['โทรศัพท์', 'มือถือ'], 'phone', 'slate'],
  [['เน็ต', 'อินเทอร์เน็ต', 'wifi'], 'wifi', 'slate'],
  [['ที่พัก', 'เช่า', 'หอ', 'บ้าน', 'คอนโด'], 'home', 'blue'],
  [['สมาชิก', 'subscription'], 'repeat', 'purple'],
  [['ของใช้', 'ซูเปอร์', 'ตลาด'], 'basket', 'green'],
  [['ช็อป', 'ชอป', 'เสื้อ', 'รองเท้า'], 'bag', 'pink'],
  [['ขวัญ'], 'gift', 'pink'],
  [['รักษา', 'ยา', 'หมอ', 'พยาบาล', 'สุขภาพ'], 'pill', 'orange'],
  [['บุญ', 'บริจาค'], 'heart', 'pink'],
  [['เที่ยว'], 'suitcase', 'blue'],
  [['หุ้น'], 'trend', 'amber'],
  [['ทอง'], 'coin', 'amber'],
  [['กองทุน'], 'pie', 'purple'],
  [['คอร์ส', 'เรียน'], 'cap', 'blue'],
  [['หนังสือ'], 'book', 'orange'],
  [['สลาก', 'หวย'], 'ticket', 'amber'],
  [['ฉุกเฉิน', 'ประกัน'], 'shield', 'green'],
  [['เงินเดือน'], 'wallet', 'teal'],
  [['ปันผล', 'ดอกเบี้ย'], 'coins', 'teal'],
  [['เสริม', 'สอน', 'ฟรีแลนซ์'], 'spark', 'teal'],
  [['ออม'], 'piggy', 'green'],
];

/** ค่าเริ่มต้นตามกลุ่ม เมื่อชื่อประเภทไม่ตรงคำไหนเลย */
const GROUP_ICON = {
  IN: ['wallet', 'teal'],
  DE: ['tag', 'orange'],
  SD: ['receipt', 'blue'],
  IV: ['trend', 'amber'],
  SV: ['piggy', 'green'],
};

const cache = new Map();

/** { icon, tone } ของประเภท — type ว่างหรือ "ไม่ระบุประเภท" ได้เครื่องหมายคำถาม */
export function categoryLook(type, group = 'DE') {
  if (!type || type === UNCATEGORISED) return { icon: 'question', tone: 'none' };
  const cacheKey = `${group}|${type}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const lower = type.toLowerCase();
  const hit = KEYWORDS.find(([words]) => words.some((w) => lower.includes(w)));
  const [name, tone] = hit ? [hit[1], hit[2]] : (GROUP_ICON[group] ?? GROUP_ICON.DE);
  const look = { icon: name, tone };
  cache.set(cacheKey, look);
  return look;
}

/**
 * กรอบวงกลมสีอ่อนพร้อมไอคอนของประเภท
 * ปกติเป็น span ตกแต่ง ถ้าส่ง tag: 'button' มาจะกลายเป็นปุ่ม (ต้องใส่ aria-label เอง)
 */
export function categoryTile(type, group, { size = 'md', tag = 'span', attrs = {} } = {}) {
  const look = categoryLook(type, group);
  return el(tag, {
    ...attrs,
    class: `tile tile-${size} tone-${look.tone} ${attrs.class ?? ''}`.trim(),
    'aria-hidden': tag === 'span' ? 'true' : null,
  }, icon(look.icon, { size: size === 'sm' ? 16 : 20 }));
}
