// ทดสอบการแปลงข้อความหารกันหลายบรรทัด — ชื่อสมมติ
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSplitLine, parseSplitText, SELF_WORDS } from '../js/split-parse.js';

const A = 'a@example.com'; // ปุณ
const B = 'b@example.com'; // เอฟ (คนพิมพ์)
const people = [
  { email: A, words: ['ปุณ', 'ที่รัก'] },
  { email: B, words: ['เอฟ', 'หมูน้อย', ...SELF_WORDS] },
];
const base = { people, mode: 'debtor', date: '2026-10-20', today: '2026-10-20' };
const p = (line, extra = {}) => parseSplitLine(line, { ...base, ...extra });

test('name first, amount before or after, dictation without spaces', () => {
  for (const line of ['ปุณ 20 ข้าวเหนียว', 'ปุณ ข้าวเหนียว 20', 'ปุณ20ข้าวเหนียว', 'ปุณ 20 บาท ข้าวเหนียว', 'ปุณ 20 บาทข้าวเหนียวค่ะ']) {
    const r = p(line);
    assert.equal(r.ok, true, line);
    assert.equal(r.kind, 'item', line);
    assert.equal(r.debtor, A, line);
    assert.equal(r.creditor, B, line);
    assert.equal(r.amount, 20, line);
    assert.equal(r.name, 'ข้าวเหนียว', line);
  }
});

test('the name means who owes, or who paid, depending on the setting', () => {
  const owes = p('เอฟ 30 รถ');
  assert.equal(owes.debtor, B);
  assert.equal(owes.creditor, A);
  const paid = p('ปุณ 20 ข้าวเหนียว', { mode: 'payer' });
  assert.equal(paid.creditor, A);
  assert.equal(paid.debtor, B);
});

test('nicknames and self words; the longest name wins', () => {
  assert.equal(p('ที่รัก 50 ไอติม').debtor, A);
  assert.equal(p('ฉัน 50 ไอติม').debtor, B);
  assert.equal(p('หมูน้อย 50 ไอติม').debtor, B);
});

test('half split needs a separate word, so ค่าอาหาร stays whole', () => {
  const h = p('ปุณ 300 หมูกระทะ หาร');
  assert.equal(h.amount, 150);
  assert.equal(h.total, 300);
  assert.equal(h.name, 'หมูกระทะ');
  assert.equal(p('ปุณ 300 หมูกระทะหารครึ่ง').amount, 150);
  const food = p('ปุณ 120 ค่าอาหาร');
  assert.equal(food.amount, 120);
  assert.equal(food.total, null);
  assert.equal(food.name, 'ค่าอาหาร');
});

test('repayment only when the rest is just the word', () => {
  const pay = p('ปุณ โอน 50');
  assert.equal(pay.kind, 'payment');
  assert.equal(pay.debtor, A);
  assert.equal(pay.creditor, B);
  assert.equal(pay.amount, 50);
  assert.equal(p('ปุณ 50 คืนเงิน').kind, 'payment');
  // payer mode ไม่เปลี่ยนความหมายของการโอน — ชื่อคือคนที่โอนเสมอ
  assert.equal(p('ปุณ โอน 50', { mode: 'payer' }).debtor, A);
  const item = p('ปุณ 80 ข้าวมื้อคืน');
  assert.equal(item.kind, 'item');
  assert.equal(item.name, 'ข้าวมื้อคืน');
});

test('เมื่อวาน / เมื่อวานซืน / วันนี้ set the date for that line', () => {
  assert.equal(p('ปุณ 20 ข้าวเหนียว เมื่อวาน').date, '2026-10-19');
  assert.equal(p('ปุณ 20 ข้าวเหนียวเมื่อวาน').name, 'ข้าวเหนียว');
  assert.equal(p('ปุณ เมื่อวานซืน 20 ข้าวเหนียว').date, '2026-10-18');
  assert.equal(p('ปุณ 20 ข้าวเหนียว', { date: '2026-10-19' }).date, '2026-10-19');
  assert.equal(p('ปุณ 20 ข้าวเหนียว วันนี้', { date: '2026-10-19' }).date, '2026-10-20');
});

test('flags: no name, no amount, nothing bought', () => {
  assert.equal(p('ข้าวเหนียว 20').error, 'who');
  assert.equal(p('ปุณ ข้าวเหนียว').error, 'amount');
  assert.equal(p('ปุณ 20').error, 'what');
  assert.equal(p('ปุณ 0 ข้าว').error, 'amount');
});

test('several lines, blank lines skipped, Thai digits and commas', () => {
  const rows = parseSplitText('ปุณ 20 ข้าวเหนียว\n\nเอฟ ๓๐ รถ\nปุณ 1,200 ตั๋วหนัง', base);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].amount, 30);
  assert.equal(rows[2].amount, 1200);
});
