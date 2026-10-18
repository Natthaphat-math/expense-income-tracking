// หารายการที่น่าจะซ้ำกัน — ระหว่างรายการจากสลิปกับรายการที่พิมพ์เอง
//
// เป็นแค่คำเตือนให้ตัดสินใจเอง ไม่ใช่การห้าม เพราะกาแฟ 45 บาทสองแก้วในวันเดียวก็มีจริง

/** ยอดน้อยกว่านี้ไม่เตือน — ของเล็ก ๆ ซ้ำกันบ่อยจนเตือนแล้วรำคาญ */
export const MIN_DUP_AMOUNT = 20;

/** ใกล้กันพอ: ต่างกันไม่เกิน 5% (อย่างน้อย 1 บาท และไม่เกิน 10 บาท) — เผื่อปัดเศษตอนพิมพ์เอง */
export function amountsClose(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  const tolerance = Math.min(10, Math.max(1, Math.max(a, b) * 0.05));
  return Math.abs(a - b) <= tolerance + 1e-9;
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysApart(a, b) {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

export function isFromSlip(tx) {
  return Boolean(tx.slipRef || tx.slipHash);
}

/** สลิปใบนี้เคยนำเข้าแล้วหรือยัง (เทียบเลขอ้างอิงจาก QR ก่อน แล้วค่อยลายนิ้วมือของไฟล์) */
export function findImported(transactions, { ref = null, hash = null }) {
  return transactions.find((t) => !t.deleted && (
    (ref && t.slipRef === ref) || (hash && t.slipHash === hash)
  )) ?? null;
}

/**
 * รายการที่คล้าย draft: ฝั่งเดียวกัน ห่างไม่เกิน 1 วัน ยอดใกล้กัน
 * ถ้าทั้งคู่ระบุประเภทแล้วและต่างกัน ถือว่าคนละรายการ
 * @param {'slip'|'manual'} among  หาเฉพาะรายการจากสลิป หรือเฉพาะที่พิมพ์เอง
 */
export function findSimilar(transactions, draft, among) {
  if (typeof draft.amount !== 'number' || draft.amount < MIN_DUP_AMOUNT || !draft.date) return [];
  return transactions
    .filter((t) => !t.deleted
      && t.id !== draft.id
      && (among === 'slip' ? isFromSlip(t) : !isFromSlip(t))
      && t.kind === draft.kind
      && amountsClose(t.amount, draft.amount)
      && daysApart(t.date, draft.date) <= 1
      && !(t.type && draft.type && t.type !== draft.type))
    .sort((a, b) => (Math.abs(a.amount - draft.amount) - Math.abs(b.amount - draft.amount))
      || (daysApart(a.date, draft.date) - daysApart(b.date, draft.date)));
}
