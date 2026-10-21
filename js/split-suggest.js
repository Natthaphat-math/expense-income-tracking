// เสนอรายจ่ายจากหารกัน — ส่วนที่เป็นของฉันจริง ๆ ลงบันทึกรายรับรายจ่ายส่วนตัว (ฟังก์ชันล้วน ทดสอบใน Node ได้)
//
// นับตามวันที่ของรายการ (ไม่ใช่วันที่โอนคืน) และไม่นับการโอนคืน — ไม่งั้นจะนับซ้ำ
//   อีกฝ่ายจ่ายให้ ฉันค้าง          → รายจ่ายของฉัน = ยอดที่ค้าง
//   ฉันจ่ายแล้วหาร (ยอดรวม total)    → รายจ่ายของฉัน = total − ส่วนที่อีกฝ่ายค้าง
//   ฉันออกให้ทั้งหมด                 → ไม่ใช่รายจ่ายของฉัน (เป็นเงินที่อีกฝ่ายค้าง)
//   ยกให้ (ไม่ต้องคืน)                → ไม่นับ
//
// รายการที่บันทึกแล้วจำ splitRef = id ของรายการหารกัน — ไม่เสนอซ้ำ และรู้ว่าต้องแก้ตามเมื่อหารกันเปลี่ยน
// ข้ามไว้ = บันทึกแบบลบแล้ว (deleted) พร้อม splitRef — ซิงก์ไปทุกเครื่อง ไม่โผล่กลับมาอีก

import { suggestType } from './parser.js';
import { groupForCategory, defaultGroupFor } from './model.js';

/** เสนอรายการย้อนหลังกี่วัน (รายการที่ยังค้างเสนอเสมอ) */
export const SUGGEST_DAYS = 30;

const round = (n) => Math.round(n * 100) / 100;

/** ส่วนที่เป็นรายจ่ายของฉันจากรายการหารกันนี้ (0 = ไม่ใช่รายจ่ายของฉัน) */
export function myShare(entry, me) {
  if (!entry || entry.kind !== 'item' || entry.deleted || entry.settledAs === 'forgiven') return 0;
  if (entry.debtor === me) return round(entry.amount);
  if (entry.creditor === me && entry.total && entry.total > entry.amount) return round(entry.total - entry.amount);
  return 0;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * @returns {{ add: object[], update: object[], remove: object[] }}
 *   add    — { entry, amount, name, date, type, group, duplicate } รายการใหม่ที่ยังไม่เคยบันทึก/ข้าม
 *   update — { entry, tx, amount, date } หารกันถูกแก้หลังจากบันทึก ยอด/วันที่ไม่ตรงแล้ว
 *   remove — { entry, tx } หารกันถูกลบหรือยกให้ ไม่ใช่รายจ่ายของฉันแล้ว
 */
export function splitSuggestions({ entries, transactions, me, today, settings, learned = null }) {
  const linked = new Map();
  for (const tx of transactions) if (tx.splitRef) linked.set(tx.splitRef, tx);
  const since = addDaysISO(today, -SUGGEST_DAYS);
  const out = { add: [], update: [], remove: [] };

  for (const entry of entries) {
    if (entry.kind !== 'item') continue;
    const share = myShare(entry, me);
    const tx = linked.get(entry.id);

    if (tx) {
      // ข้ามไว้/ลบเองแล้ว หรือแก้รายการของตัวเองทีหลังหารกัน — เคารพที่ทำไว้
      if (tx.deleted || (tx.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) continue;
      if (share <= 0) out.remove.push({ entry, tx });
      else if (round(tx.amount ?? 0) !== share || tx.date !== entry.date) {
        out.update.push({ entry, tx, amount: share, date: entry.date });
      }
      continue;
    }

    if (share <= 0) continue;
    if (entry.settled && entry.date < since) continue;
    if (entry.date > today) continue;

    const suggestion = suggestType(entry.name, { categories: settings.categories, kind: 'expense', learned });
    const type = suggestion?.type ?? null;
    // อาจบันทึกเองไปแล้ว (เช่นจากสลิป) — วันเดียวกัน ยอดเท่าส่วนของฉันหรือเท่ายอดรวมที่จ่าย
    const duplicate = transactions.find((t) => !t.deleted && t.kind === 'expense' && !t.splitRef
      && t.date === entry.date && (t.amount === share || (entry.total && t.amount === entry.total))) ?? null;
    out.add.push({
      entry,
      amount: share,
      name: entry.name,
      date: entry.date,
      type,
      group: type ? groupForCategory(settings, type, 'expense') : defaultGroupFor('expense'),
      duplicate,
    });
  }
  out.add.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function suggestionCount(s) {
  return s.add.length + s.update.length + s.remove.length;
}
