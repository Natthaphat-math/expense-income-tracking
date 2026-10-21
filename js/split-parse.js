// หารกัน: แปลงข้อความหลายบรรทัดเป็นรายการ (ฟังก์ชันล้วน ทดสอบใน Node ได้)
//
//   ปุณ 20 ข้าวเหนียว        ชื่อขึ้นต้นบรรทัด แล้วยอด แล้วสิ่งที่จ่าย
//   ปุณ ข้าวเหนียว 20        ยอดอยู่ท้ายก็ได้
//   ปุณ20ข้าวเหนียว           พิมพ์ด้วยเสียง ไม่มีช่องว่าง
//   ปุณ 300 หมูกระทะ หาร     หารครึ่ง (ต้องมีช่องว่างก่อน "หาร" ไม่งั้น "ค่าอาหาร" จะกลายเป็นหาร)
//   ปุณ โอน 50               การโอนคืน — ชื่อคือคนที่โอน
//   ปุณ 20 ข้าวเหนียว เมื่อวาน
//
// ชื่อหน้าบรรทัดหมายถึงอะไร แล้วแต่คนใช้ ("debtor" = คนที่ค้าง, "payer" = คนที่จ่ายไป)

import { normalizeLine, POLITE_ENDING } from './parser.js';
import { addDays } from './format.js';

/** คำที่หมายถึงตัวเอง */
export const SELF_WORDS = ['ตัวเอง', 'ฉัน', 'ผม', 'เรา', 'หนู'];

/** ทั้งบรรทัดเหลือแค่คำเหล่านี้ = การโอนคืน */
const PAYMENT_WORDS = ['โอนคืน', 'จ่ายคืน', 'คืนเงิน', 'โอนให้', 'โอนเงิน', 'โอน', 'คืน'];

const CURRENCY = /^\s*(บาทถ้วน|บาท|บ\.)/;
const HALF_TAIL = /(?:\s(?:หารครึ่ง|หารสอง|หาร\s*2|หาร)|หารครึ่ง|หารสอง)$/;
const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {string} line
 * @param {object} o
 * @param {Array<{email: string, words: string[]}>} o.people  สองคน พร้อมคำที่ใช้เรียกแต่ละคน
 * @param {'debtor'|'payer'} o.mode  ชื่อหน้าบรรทัดคือคนที่ค้าง หรือคนที่จ่าย
 * @param {string} o.date  วันที่ของทั้งชุด (YYYY-MM-DD)
 * @param {string} o.today วันนี้ตามปฏิทิน (สำหรับ "เมื่อวาน")
 * @returns {{raw, ok, error?, kind?, person?, debtor?, creditor?, amount?, total?, name?, date?, half?}}
 */
export function parseSplitLine(line, { people, mode, date, today, requirePerson = true }) {
  const raw = String(line ?? '');
  let text = normalizeLine(raw).replace(POLITE_ENDING, '').trim();
  const out = { raw, ok: false };
  if (!text) return { ...out, error: 'empty' };

  // วันที่ในบรรทัด — ตัดออกจากข้อความ
  let lineDate = date;
  const day = text.match(/เมื่อวานซืน|เมื่อวาน|วันนี้/);
  if (day) {
    lineDate = day[0] === 'วันนี้' ? today : addDays(today, day[0] === 'เมื่อวานซืน' ? -2 : -1);
    text = `${text.slice(0, day.index)} ${text.slice(day.index + day[0].length)}`.replace(/\s+/g, ' ').trim();
  }

  // ใคร — คำที่ยาวที่สุดที่ขึ้นต้นบรรทัด
  let person = null;
  let matched = '';
  for (const p of people) {
    for (const w of p.words) {
      const word = String(w ?? '').trim().toLowerCase();
      if (word && text.toLowerCase().startsWith(word) && word.length > matched.length) {
        person = p.email;
        matched = word;
      }
    }
  }
  if (!person && requirePerson) return { ...out, error: 'who' };
  text = text.slice(matched.length).trim();

  // ยอด — ตัวเลขแรก แล้วตัดคำว่าบาทที่ตามหลัง
  const num = text.match(/\d+(?:\.\d+)?/);
  if (!num) return { ...out, person, error: 'amount' };
  let amount = round(Number(num[0]));
  if (!(amount > 0 && amount < 100000000)) return { ...out, person, error: 'amount' };
  const after = text.slice(num.index + num[0].length).replace(CURRENCY, '');
  text = `${text.slice(0, num.index)} ${after}`.replace(/\s+/g, ' ').trim();

  // ไม่ได้บอกชื่อ (ช่องพิมพ์เร็วในฟอร์ม) — ฟอร์มเป็นคนเลือกว่าใครจ่าย
  if (!person) {
    let half = false;
    if (HALF_TAIL.test(text)) {
      half = true;
      text = text.replace(HALF_TAIL, '').trim();
    }
    if (!text) return { ...out, error: 'what' };
    return { raw, ok: true, kind: 'item', person: null, amount: half ? round(amount / 2) : amount, total: half ? amount : null, name: text.slice(0, 200), date: lineDate, half };
  }

  const other = people.find((p) => p.email !== person)?.email;

  // การโอนคืน: เหลือแค่คำว่าโอน/คืน
  if (PAYMENT_WORDS.includes(text)) {
    return { raw, ok: true, kind: 'payment', person, debtor: person, creditor: other, amount, total: null, name: '', date: lineDate };
  }

  let half = false;
  if (HALF_TAIL.test(text)) {
    half = true;
    text = text.replace(HALF_TAIL, '').trim();
  }
  if (!text) return { ...out, person, error: 'what' };

  const total = half ? amount : null;
  if (half) amount = round(amount / 2);
  const debtor = mode === 'payer' ? other : person;
  const creditor = mode === 'payer' ? person : other;
  return { raw, ok: true, kind: 'item', person, debtor, creditor, amount, total, name: text.slice(0, 200), date: lineDate, half };
}

/** แยกบรรทัด ตัดบรรทัดว่าง */
export function parseSplitText(text, options) {
  return String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => parseSplitLine(l, options));
}
