// ตัวอ่านสลิปจำลองสำหรับพรีวิวเท่านั้น — พรีวิวเป็นไฟล์เดียว โหลดตัวอ่านจริง (5 MB) ไม่ได้
// ไม่ว่าเลือกรูปอะไร จะได้สลิปสมมติวนกันสามแบบ (ชื่อและเลขทั้งหมดแต่งขึ้น)
// ลายนิ้วมือคำนวณจากไฟล์จริง เลือกรูปเดิมซ้ำจึงเห็นป้าย "นำเข้าแล้ว" ได้เหมือนแอปจริง

import { todayISO } from '../js/format.js';

const FAKE = [
  { amount: 59, to: 'ร้านป้าแดง ข้าวแกง', from: 'นางสาว ตัวอย่าง ใจดี', bank: '004', bankName: 'กสิกรไทย', time: '12:41', selfTransfer: false },
  { amount: 432.5, to: 'การไฟฟ้านครหลวง', from: 'นางสาว ตัวอย่าง ใจดี', bank: '006', bankName: 'กรุงไทย', time: '19:05', selfTransfer: false },
  { amount: 1000, to: 'นางสาว ตัวอย่าง ใ', from: 'นางสาว ตัวอย่าง ใจดี', bank: '069', bankName: 'เกียรตินาคินภัทร', time: '21:30', selfTransfer: true },
];

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let count = 0;

export async function openSlipReader(onStatus = () => {}) {
  onStatus({ stage: 'ready' });
  return {
    async read(file) {
      await new Promise((r) => setTimeout(r, 500));
      const hash = await sha256(await file.arrayBuffer());
      const fake = FAKE[count++ % FAKE.length];
      const ref = `${fake.bank}:PREVIEW${hash.slice(0, 12).toUpperCase()}`;
      return { ...fake, hash, qr: null, ref, date: todayISO() };
    },
    close() {},
  };
}
