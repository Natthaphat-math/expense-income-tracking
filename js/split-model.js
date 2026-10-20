// หารกัน — โครงข้อมูลและการคำนวณยอดค้าง (ฟังก์ชันล้วน ทดสอบใน Node ได้)
//
// มีสองแบบ:
//   item    — creditor จ่ายแทน debtor ไป amount บาท (debtor ค้าง creditor)
//             total = ยอดที่จ่ายไปทั้งหมด (เช่นหารครึ่ง total 500 amount 250) ไม่บังคับ
//   payment — debtor โอนคืนให้ creditor amount บาท (โอนบางส่วนได้)
//
// ยอดค้าง = รายการที่ยังไม่เคลียร์ ลบ การโอนคืนที่ยังไม่เคลียร์ แยกตามทิศ แล้วหักลบสองทิศกัน
// "เคลียร์แล้ว" (settled) = ตกลงกันแล้ว ไม่นับในยอดอีก — ติ๊กทีละรายการ หรือเคลียร์ทั้งหมดก็ได้
// การโอนคืนที่ยังไม่เคลียร์ จะถูกนำไปหักรายการเก่าสุดก่อน (เพื่อบอกว่ารายการไหนจ่ายแล้วบ้าง)

export const SPLIT_KINDS = ['item', 'payment'];
export const MAX_SPLIT_AMOUNT = 100000000;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function isAmount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < MAX_SPLIT_AMOUNT;
}

function stamp(n) {
  return Number.isInteger(n) && n > 946684800000 && n < 4102444800000;
}

/**
 * ตรวจข้อมูลที่อ่านมาจาก Firestore — ถือว่าไม่น่าเชื่อถือเสมอ (อีกเครื่องอาจเป็นแอปรุ่นเก่า/แก้มือ)
 * @param {string[]} members อีเมลของสองคนในคู่นี้
 * @returns {object|null}
 */
export function sanitizeSplit(raw, members) {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw;
  if (!ID_RE.test(d.id ?? '')) return null;
  if (!SPLIT_KINDS.includes(d.kind)) return null;
  if (!members.includes(d.debtor) || !members.includes(d.creditor) || d.debtor === d.creditor) return null;
  if (!isAmount(d.amount)) return null;
  const total = d.total === null || d.total === undefined ? null : d.total;
  if (total !== null && (!isAmount(total) || total < d.amount)) return null;
  const name = typeof d.name === 'string' ? d.name.slice(0, 200) : '';
  if (d.kind === 'item' && name.trim().length === 0) return null;
  if (!DATE_RE.test(d.date ?? '')) return null;
  if (!members.includes(d.createdBy)) return null;
  return {
    id: d.id,
    kind: d.kind,
    debtor: d.debtor,
    creditor: d.creditor,
    amount: Math.round(d.amount * 100) / 100,
    total: total === null ? null : Math.round(total * 100) / 100,
    name,
    date: d.date,
    settled: d.settled === true,
    settledBy: members.includes(d.settledBy) ? d.settledBy : null,
    settledAt: stamp(d.settledAt) ? d.settledAt : null,
    createdBy: d.createdBy,
    createdAt: stamp(d.createdAt) ? d.createdAt : 0,
    updatedAt: stamp(d.updatedAt) ? d.updatedAt : 0,
    updatedBy: members.includes(d.updatedBy) ? d.updatedBy : d.createdBy,
    deleted: d.deleted === true,
  };
}

/** เอกสารที่จะเขียนลง Firestore — ฟิลด์ตรงกับกฎทุกตัว */
export function toSplitDoc(entry, by, now = Date.now()) {
  return {
    id: entry.id,
    kind: entry.kind,
    debtor: entry.debtor,
    creditor: entry.creditor,
    amount: Math.round(entry.amount * 100) / 100,
    total: entry.total === null || entry.total === undefined ? null : Math.round(entry.total * 100) / 100,
    name: String(entry.name ?? '').trim().slice(0, 200),
    date: entry.date,
    settled: entry.settled === true,
    settledBy: entry.settled ? (entry.settledBy ?? by) : null,
    settledAt: entry.settled ? (entry.settledAt ?? now) : null,
    createdBy: entry.createdBy ?? by,
    createdAt: entry.createdAt ?? now,
    updatedAt: now,
    updatedBy: by,
    deleted: entry.deleted === true,
  };
}

export function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value);
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * สรุปยอดจากมุมของ me
 * @returns {{
 *   net: number,              // บวก = อีกฝ่ายค้างเรา, ลบ = เราค้างอีกฝ่าย
 *   open: object[],           // รายการ/การโอนที่ยังนับอยู่ ใหม่สุดก่อน พร้อม remaining
 *   history: object[],        // เคลียร์แล้ว (ติ๊ก หรือถูกโอนคืนครบ) ใหม่สุดก่อน
 * }}
 */
export function summarizeSplits(entries, me) {
  const live = entries.filter((e) => !e.deleted);
  const open = [];
  const history = [];
  let net = 0;

  // แยกตามทิศ: key = debtor → creditor
  const byDirection = new Map();
  for (const e of live) {
    if (e.settled) {
      history.push({ ...e, remaining: 0, clearedBy: 'tick' });
      continue;
    }
    const key = `${e.debtor}>${e.creditor}`;
    if (!byDirection.has(key)) byDirection.set(key, { items: [], payments: [] });
    byDirection.get(key)[e.kind === 'item' ? 'items' : 'payments'].push(e);
  }

  for (const { items, payments } of byDirection.values()) {
    // เก่าสุดก่อน: วันที่ แล้วเวลาที่สร้าง — เงินที่โอนคืนหักรายการเก่าก่อน
    const oldest = (x, y) => x.date.localeCompare(y.date) || x.createdAt - y.createdAt;
    const pays = [...payments].sort(oldest).map((p) => ({ ...p, left: p.amount }));
    let owed = 0;
    for (const item of [...items].sort(oldest)) {
      let need = item.amount;
      for (const p of pays) {
        if (need <= 0) break;
        const take = Math.min(p.left, need);
        p.left = round(p.left - take);
        need = round(need - take);
      }
      if (need <= 0) history.push({ ...item, remaining: 0, clearedBy: 'payment' });
      else open.push({ ...item, remaining: need, partly: need < item.amount });
      owed = round(owed + need);
    }
    // การโอนที่หักรายการหมดแล้วย้ายไปประวัติ ที่ยังเหลือ (โอนเกิน) ค้างไว้ให้เห็น
    let credit = 0;
    for (const p of pays) {
      const { left, ...entry } = p;
      if (left <= 0) history.push({ ...entry, remaining: 0, clearedBy: 'used' });
      else open.push({ ...entry, remaining: left, partly: left < p.amount });
      credit = round(credit + left);
    }

    const debtor = items[0]?.debtor ?? payments[0]?.debtor;
    // โอนเกินยอดในทิศนี้ = อีกฝ่ายกลายเป็นค้างคืน
    const balance = round(owed - credit);
    net = round(net + (debtor === me ? -balance : balance));
  }

  const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
  open.sort(newestFirst);
  history.sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0) || newestFirst(a, b));
  return { net, open, history };
}

/** รายการที่อีกฝ่ายเพิ่ม/แก้หลังจากที่เราเปิดดูครั้งล่าสุด */
export function unseenCount(entries, me, seenAt) {
  return entries.filter((e) => !e.deleted && e.updatedBy !== me && e.updatedAt > seenAt).length;
}
