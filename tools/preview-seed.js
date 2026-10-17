// โหลดก่อนแอปเสมอ (ดู tools/preview-entry.js) — ใส่ข้อมูลตัวอย่างถ้ายังไม่มี
// และติดแถบบอกชัด ๆ ว่าเป็นข้อมูลสมมติ ไม่ใช่ข้อมูลจริงของใคร

import { makeDemoData } from './demo-data.js';
import { todayISO } from '../js/format.js';

const TX_KEY = 'tet:transactions:v1';
const SETTINGS_KEY = 'tet:settings:v1';

export function seedDemo(force = false) {
  try {
    if (!force && localStorage.getItem(TX_KEY)) return;
    const demo = makeDemoData(todayISO());
    localStorage.setItem(TX_KEY, JSON.stringify(demo.transactions));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ...demo.settings, carryOverBalance: true, lastBackupAt: null, updatedAt: 1,
    }));
  } catch {
    // เครื่องไม่ให้เก็บข้อมูล — แอปจะเปิดแบบว่างในหน่วยความจำ
  }
}

seedDemo();
document.documentElement.lang = 'th';
