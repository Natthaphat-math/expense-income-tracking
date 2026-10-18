// ทดสอบการแกะสลิป — ข้อความจำลองจากผล OCR (ชื่อและเลขทั้งหมดสมมติ ไม่ใช่สลิปจริง)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSlip, parseSlipQR, findSlipDate, findSlipTime, findSlipAmount, looksLikeSamePerson,
} from '../js/slip-parse.js';

/** สร้าง payload QR แบบเดียวกับสลิปจริง (ไม่คำนวณ CRC เพราะตัวแกะไม่ได้ใช้) */
function qr(bank, ref) {
  const tlv = (tag, v) => `${tag}${String(v.length).padStart(2, '0')}${v}`;
  return tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref)) + tlv('51', 'TH') + tlv('91', 'ABCD');
}

test('QR: bank code and reference', () => {
  assert.deepEqual(parseSlipQR(qr('004', '012345678901ABC00001')),
    { bank: '004', ref: '012345678901ABC00001', key: '004:012345678901ABC00001' });
  assert.equal(parseSlipQR('https://example.com'), null);
  assert.equal(parseSlipQR(qr('4', 'ABCDEF12')), null);          // รหัสธนาคารต้อง 3 หลัก
  assert.equal(parseSlipQR(qr('004', 'ab<script>')), null);       // เลขอ้างอิงเฉพาะตัวอักษร/ตัวเลข
  assert.equal(parseSlipQR(null), null);
});

test('date: Buddhist-era years, short and long, with OCR noise in the month', () => {
  assert.equal(findSlipDate('19 ต.ค. 69 02:10 น.').iso, '2026-10-19');
  assert.equal(findSlipDate('วันที่ทํารายการ 19 ต.ค. 2569 - 02:11').iso, '2026-10-19');
  assert.equal(findSlipDate('วันที่ 3 ต๓.ค. 2569').iso, '2026-10-03');
  assert.equal(findSlipDate('1 มี.ค. 2570').iso, '2027-03-01');
  assert.equal(findSlipDate('31 ก.พ. 2569'), null);              // ไม่มีวันนี้
  assert.equal(findSlipDate('ไม่มีวันที่'), null);
});

test('time: colon, and a colon misread as a digit', () => {
  const at = (t) => findSlipTime(t, 0);
  assert.equal(at(' 02:10 น.'), '02:10');
  assert.equal(at(' - 21.45'), '21:45');
  assert.equal(at(' 02410 น.'), '02:10');
  assert.equal(at(' 99:99'), null);
});

test('amount: the largest money value, so the fee line never wins', () => {
  assert.equal(findSlipAmount('จํานวน:\n25.00 บาท\nค่าธรรมเนียม:\n0.00 บาท'), 25);
  assert.equal(findSlipAmount('ค่าธรรมเนียม 10.00 บาท\nจำนวนเงิน 1,234.50 บาท'), 1234.5);
  assert.equal(findSlipAmount('เลขที่รายการ 012345678901'), null); // เลขอ้างอิงไม่ใช่เงิน
});

test('same person: shortened surname and OCR slips still match; different people do not', () => {
  assert.equal(looksLikeSamePerson('นาย สมชาย ใ', 'นายสมชาย ใจดี'), true);
  assert.equal(looksLikeSamePerson('นายสมซาย ใ* **', 'นาย สมชาย ใจดี'), true);
  assert.equal(looksLikeSamePerson('นาย สมชาย ใจดี', 'นางสาว สมหญิง ใจดี'), false);
  assert.equal(looksLikeSamePerson('นาย สมชาย ใจดี', 'นาย สมชาย รักชาติ'), false);
});

test('K PLUS layout: names without labels, fee on its own line', () => {
  const text = [
    '@๑  โอนเงินสําเร็จ                       1(<+',
    '19 ต.ค. 69 02410 น.',
    '  นาย สมชาย ใ',
    'ธ.กสิกรไทย',
    '%%%-%-%1234-%',
    '๐๑ นาย มานี มีนา',
    'ธ.กรุงไทย',
    'จํานวน:',
    '120.00 บาท   [ต27 [ต]',
    'ค่าธรรมเนียม:',
    '0.00 บาท    อาล่าระ',
  ].join('\n');
  const slip = parseSlip(text, qr('004', '012345678901ABC00001'));
  assert.equal(slip.amount, 120);
  assert.equal(slip.date, '2026-10-19');
  assert.equal(slip.time, '02:10');
  assert.equal(slip.from, 'นาย สมชาย ใ');
  assert.equal(slip.to, 'นาย มานี มีนา');
  assert.equal(slip.bankName, 'กสิกรไทย');
  assert.equal(slip.ref, '004:012345678901ABC00001');
  assert.equal(slip.selfTransfer, false);
});

test('labelled layout (จาก / ไปยัง) with junk before the title and a right-hand column', () => {
  const text = [
    'โอนเงิน',
    '45.50 บาท',
    'ค่าธรรมเนียม 0.00 บาท',
    'จาก นาย สมชาย ใจดี                  เซฟ',
    'ไปยัง นพนาย สมชาย ใจดี                    ไท  #',
    'วันที่ 19 ต.ค. 2569 - 02:09 น.                  @เกาอ!',
  ].join('\n');
  const slip = parseSlip(text, null);
  assert.equal(slip.amount, 45.5);
  assert.equal(slip.to, 'นาย สมชาย ใจดี');
  assert.equal(slip.selfTransfer, true);
  assert.equal(slip.ref, null);
});

test('stripTitle: drops personal titles, keeps shop and company words', async () => {
  const { stripTitle } = await import('../js/slip-parse.js');
  assert.equal(stripTitle('นางสาว มานี มีนา'), 'มานี มีนา');
  assert.equal(stripTitle('นายสมชาย ใ* **'), 'สมชาย ใ');
  assert.equal(stripTitle('ร้านป้าแดง ข้าวแกง'), 'ร้านป้าแดง ข้าวแกง');
  assert.equal(stripTitle('บริษัท ตัวอย่าง จำกัด'), 'บริษัท ตัวอย่าง จำกัด');
});
