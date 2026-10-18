// แกะข้อมูลจากสลิปโอนเงิน — ฟังก์ชันล้วน ไม่แตะ DOM จึงทดสอบใน Node ได้
//
// แหล่งข้อมูลสองทาง:
// 1) QR บนสลิป (มาตรฐานตรวจสอบสลิปของธนาคารไทย) — บอกรหัสธนาคารและเลขอ้างอิงที่ไม่ซ้ำ
//    ใช้กันนำเข้าซ้ำได้แม่นยำ แต่ไม่มีจำนวนเงินหรือวันที่
// 2) ข้อความที่อ่านจากรูป (OCR) — จำนวนเงิน วันที่ เวลา ชื่อผู้โอน/ผู้รับ
//    อ่านพลาดได้ จึงเป็นค่าเริ่มต้นให้ตรวจก่อนบันทึกเสมอ

/** ชื่อธนาคารตามรหัสในสลิป */
export const BANKS = {
  '002': 'กรุงเทพ', '004': 'กสิกรไทย', '006': 'กรุงไทย', '011': 'ทีทีบี',
  '014': 'ไทยพาณิชย์', '022': 'ซีไอเอ็มบี', '024': 'ยูโอบี', '025': 'กรุงศรี',
  '030': 'ออมสิน', '033': 'อาคารสงเคราะห์', '034': 'ธ.ก.ส.', '067': 'ทิสโก้',
  '069': 'เกียรตินาคินภัทร', '073': 'แลนด์ แอนด์ เฮ้าส์',
};

/** แยก TLV (แท็ก 2 หลัก ความยาว 2 หลัก ข้อมูล) — คืน null ถ้ารูปแบบไม่ครบ */
function parseTLV(text) {
  const out = {};
  let i = 0;
  while (i < text.length) {
    if (i + 4 > text.length) return null;
    const tag = text.slice(i, i + 2);
    const len = Number(text.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len)) return null;
    const value = text.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out[tag] = value;
    i += 4 + len;
  }
  return out;
}

/**
 * ข้อมูลใน QR ของสลิป เช่น "0041000600000101030040220012345678901ABC000015102TH9104…"
 * แท็ก 00 = ข้อมูลสลิป (00 รหัส API "000001", 01 รหัสธนาคาร, 02 เลขอ้างอิง)
 * @returns {{ bank: string, ref: string, key: string } | null}
 */
export function parseSlipQR(payload) {
  if (typeof payload !== 'string' || payload.length > 512) return null;
  const top = parseTLV(payload.trim());
  if (!top?.['00']) return null;
  const inner = parseTLV(top['00']);
  if (!inner || inner['00'] !== '000001') return null;
  const bank = inner['01'];
  const ref = inner['02'];
  if (!/^\d{3}$/.test(bank ?? '') || !/^[A-Za-z0-9]{6,40}$/.test(ref ?? '')) return null;
  return { bank, ref, key: `${bank}:${ref}` };
}

const MONTHS = {
  มค: 1, กพ: 2, มีค: 3, เมย: 4, พค: 5, มิย: 6, กค: 7, สค: 8, กย: 9, ตค: 10, พย: 11, ธค: 12,
};

const THAI_DIGITS = /[๐-๙]/g;

/** "19 ต.ค. 69" / "19 ต.ค. 2569" → "2026-10-19" (ปีพุทธศักราชแปลงเป็น ค.ศ.) */
export function findSlipDate(text) {
  // อยู่บรรทัดเดียวกันเท่านั้น และลองใหม่ทีละตัวอักษร เพราะเศษตัวเลขก่อนหน้า (เช่น "1(<+")
  // อาจกินวันที่จริงที่ตามมาไปเป็นส่วนหนึ่งของการจับคู่ที่ผิด
  const re = /(?<!\d)(\d{1,2})[ \t]*([^\s\d]{2,8})[ \t]*(\d{4}|\d{2})(?!\d)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    re.lastIndex = m.index + 1;
    const token = m[2].replace(/[.\s]/g, '').replace(THAI_DIGITS, '');
    const month = MONTHS[token];
    if (!month) continue;
    const day = Number(m[1]);
    let year = Number(m[3]);
    if (m[3].length === 2) year += 2500;   // "69" บนสลิปคือ พ.ศ. 2569
    if (year > 2400) year -= 543;
    if (year < 2000 || year > 2100 || day < 1 || day > 31) continue;
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { iso, index: m.index + m[0].length };
  }
  return null;
}

/** เวลาหลังวันที่ — "02:10" หรือที่ OCR อ่านเครื่องหมาย : เป็นตัวเลข เช่น "02410 น." */
export function findSlipTime(text, from = 0) {
  const rest = text.slice(from, from + 40);
  const m = rest.match(/(\d{1,2})\s*[:.]\s*(\d{2})(?!\d)/) ?? rest.match(/(?<!\d)(\d{2})\d(\d{2})\s*น/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * จำนวนเงิน = ค่าที่มากที่สุดในรูปแบบ "1,234.56" บนสลิป
 * ค่าธรรมเนียมอยู่คนละบรรทัดกับป้ายของมันในบางธนาคาร จึงตัดด้วยป้ายไม่ได้
 * แต่ค่าธรรมเนียมน้อยกว่ายอดโอนเสมอ
 */
export function findSlipAmount(text) {
  let best = null;
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{1,9})\.(\d{2})(?![\d])/g)) {
    const value = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
    if (Number.isFinite(value) && (best === null || value > best)) best = value;
  }
  return best;
}

const TITLE = /(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|MRS?\.?|MS\.?|MISS|บริษัท|บจก\.?|หจก\.?|ร้าน)/i;

/** ทำความสะอาดชื่อที่ OCR อ่านมา: ตัดคอลัมน์ขวา (ช่องว่างยาว) และอักขระแปลก ๆ */
function cleanName(raw) {
  const left = raw.split(/\s{3,}/)[0];
  return left
    .replace(/[^฀-๿A-Za-z.\s]/g, ' ')
    .replace(/[๐-๙]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ชื่อผู้โอนและผู้รับ — ใช้ป้าย "จาก"/"ไปยัง" ถ้ามี ไม่งั้นเอาบรรทัดที่มีคำนำหน้าชื่อ
 * ตามลำดับ (บรรทัดแรก = ผู้โอน บรรทัดที่สอง = ผู้รับ)
 */
export function findSlipNames(text) {
  const lines = text.split(/\r?\n/);
  let from = null;
  let to = null;
  const named = [];
  lines.forEach((line, i) => {
    const label = line.match(/^\s*\W{0,3}\s*(จาก|ไปยัง)\s*(.*)$/);
    if (label) {
      let rest = cleanName(label[2]);
      if (!rest && lines[i + 1]) rest = cleanName(lines[i + 1]);
      // ตัวอักษรเพี้ยนหน้าคำนำหน้าชื่อ ("นพนาย ...") ตัดทิ้ง
      const t = rest.match(TITLE);
      if (t && t.index > 0) rest = rest.slice(t.index);
      if (label[1] === 'จาก' && !from) from = rest || null;
      if (label[1] === 'ไปยัง' && !to) to = rest || null;
    }
    const t = line.match(TITLE);
    if (t) {
      const name = cleanName(line.slice(t.index));
      if (name.length >= 4) named.push(name);
    }
  });
  // ชื่อที่ได้จากป้ายบางทีพาคำนำหน้ามาไม่ครบ ใช้บรรทัดที่มีคำนำหน้าแทนถ้ามี
  from = (from && named.find((n) => n.includes(stripTitle(from)))) ?? from ?? named[0] ?? null;
  to = (to && named.find((n) => n.includes(stripTitle(to)))) ?? to ?? named.find((n) => n !== from) ?? null;
  return { from, to };
}

/** คำนำหน้าชื่อคน — ตัดออกได้ ส่วนคำบอกกิจการ (ร้าน บริษัท) เป็นส่วนหนึ่งของชื่อ เก็บไว้ */
const PERSON_TITLE = /^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|MRS?\.?|MS\.?|MISS)\s*/i;

export function stripTitle(name) {
  return String(name ?? '').replace(PERSON_TITLE, '').replace(/[*.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * ผู้โอนกับผู้รับน่าจะเป็นคนเดียวกันไหม (โอนเข้าบัญชีตัวเอง)
 * สลิปมักย่อนามสกุล ("สมชาย ใ") และ OCR อ่านพยัญชนะพลาดได้ จึงเทียบแบบยืดหยุ่น:
 * ชื่อต้นคล้ายกันอย่างน้อย 60% และนามสกุลขึ้นต้นด้วยตัวเดียวกัน (ถ้ามีทั้งคู่)
 */
export function looksLikeSamePerson(a, b) {
  const pa = stripTitle(a).split(' ').filter(Boolean);
  const pb = stripTitle(b).split(' ').filter(Boolean);
  if (pa.length === 0 || pb.length === 0) return false;
  const [fa, la] = pa;
  const [fb, lb] = pb;
  if (fa.length < 2 || fb.length < 2) return false;
  const similarity = 1 - levenshtein(fa, fb) / Math.max(fa.length, fb.length);
  if (similarity < 0.6) return false;
  if (la && lb && la[0] !== lb[0]) return false;
  return true;
}

/**
 * รวมทุกอย่างเป็นร่างรายการหนึ่งรายการ
 * @param {string} text ข้อความจาก OCR
 * @param {string|null} qr ข้อมูลใน QR (ถ้าอ่านได้)
 */
export function parseSlip(text, qr = null) {
  const normalized = String(text ?? '');
  const date = findSlipDate(normalized);
  const names = findSlipNames(normalized);
  const slip = parseSlipQR(qr);
  return {
    amount: findSlipAmount(normalized),
    date: date?.iso ?? null,
    time: date ? findSlipTime(normalized, date.index) : null,
    from: names.from,
    to: names.to,
    bank: slip?.bank ?? null,
    bankName: slip ? (BANKS[slip.bank] ?? null) : null,
    ref: slip?.key ?? null,
    selfTransfer: Boolean(names.from && names.to && looksLikeSamePerson(names.from, names.to)),
  };
}
