// เสนอรายจ่ายจากหารกัน: ส่วนของฉัน, ไม่เสนอซ้ำ, ตามแก้/ลบ, และเตือนรายการที่อาจบันทึกไว้แล้ว
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myShare, splitSuggestions } from '../js/split-suggest.js';
import { makeDefaultSettings } from '../js/model.js';

const ME = 'her@example.com';
const HIM = 'him@example.com';
const TODAY = '2026-10-21';
const settings = makeDefaultSettings();
const item = (over) => ({
  id: over.id ?? `s${Math.random().toString(36).slice(2, 8)}`, kind: 'item', debtor: ME, creditor: HIM,
  amount: 100, total: null, name: 'ค่าไฟ', date: '2026-10-20', settled: false, settledAs: undefined,
  deleted: false, createdAt: 1000, updatedAt: 1000, ...over,
});
const run = (entries, transactions = []) => splitSuggestions({ entries, transactions, me: ME, today: TODAY, settings });

test('ส่วนของฉัน: ฉันค้าง = ยอดค้าง, ฉันจ่ายแล้วหาร = ส่วนที่เหลือ, ออกให้ทั้งหมด/โอนคืน/ยกให้ = 0', () => {
  assert.equal(myShare(item({ amount: 300 }), ME), 300);
  assert.equal(myShare(item({ debtor: HIM, creditor: ME, amount: 200, total: 400 }), ME), 200);
  assert.equal(myShare(item({ debtor: HIM, creditor: ME, amount: 150, total: null }), ME), 0);
  assert.equal(myShare(item({ kind: 'payment', amount: 50 }), ME), 0);
  assert.equal(myShare(item({ settled: true, settledAs: 'forgiven' }), ME), 0);
  assert.equal(myShare(item({ deleted: true }), ME), 0);
});

test('เสนอรายการใหม่ ประเภทเดาจากชื่อ ตามวันที่ของรายการ', () => {
  const s = run([item({ id: 'a', name: 'ค่าไฟ', amount: 300 }), item({ id: 'b', debtor: HIM, creditor: ME, amount: 60, total: 120, name: 'ข้าวมันไก่', date: '2026-10-19' })]);
  assert.deepEqual(s.add.map((a) => [a.entry.id, a.amount, a.date]), [['b', 60, '2026-10-19'], ['a', 300, '2026-10-20']]);
  assert.equal(s.add.find((a) => a.entry.id === 'a').type, 'ค่าไฟฟ้า');
});

test('รายการค้างเก่าแค่ไหนก็เสนอ ที่เคลียร์แล้วเสนอแค่ 30 วันล่าสุด', () => {
  const s = run([
    item({ id: 'old-open', date: '2026-01-05' }),
    item({ id: 'old-settled', date: '2026-08-01', settled: true, settledAs: 'paid' }),
    item({ id: 'new-settled', date: '2026-10-01', settled: true, settledAs: 'paid' }),
  ]);
  assert.deepEqual(s.add.map((a) => a.entry.id).sort(), ['new-settled', 'old-open']);
});

test('บันทึกแล้วหรือข้ามแล้ว ไม่เสนอซ้ำ', () => {
  const s = run([item({ id: 'a' }), item({ id: 'b' })], [
    { id: 't1', kind: 'expense', amount: 100, date: '2026-10-20', splitRef: 'a', deleted: false, updatedAt: 2000 },
    { id: 't2', kind: 'expense', amount: 100, date: '2026-10-20', splitRef: 'b', deleted: true, updatedAt: 2000 },
  ]);
  assert.equal(s.add.length + s.update.length + s.remove.length, 0);
});

test('หารกันถูกแก้หลังบันทึก → เสนอแก้ตาม · ถูกลบ/ยกให้ → เสนอลบ · ฉันแก้เองทีหลัง → ไม่ยุ่ง', () => {
  const tx = (id, ref, at, amount = 100) => ({ id, kind: 'expense', name: 'ค่าไฟ', amount, date: '2026-10-20', splitRef: ref, deleted: false, updatedAt: at });
  const s = run([
    item({ id: 'edited', amount: 350, updatedAt: 3000 }),
    item({ id: 'gone', deleted: true, updatedAt: 3000 }),
    item({ id: 'gift', settled: true, settledAs: 'forgiven', updatedAt: 3000 }),
    item({ id: 'mine-later', amount: 999, updatedAt: 3000 }),
  ], [tx('t1', 'edited', 2000), tx('t2', 'gone', 2000), tx('t3', 'gift', 2000), tx('t4', 'mine-later', 4000, 50)]);
  assert.deepEqual(s.update.map((u) => [u.tx.id, u.amount]), [['t1', 350]]);
  assert.deepEqual(s.remove.map((r) => r.tx.id).sort(), ['t2', 't3']);
});

test('เตือนรายการที่อาจบันทึกเองแล้ว (วันเดียวกัน ยอดเท่าส่วนของฉันหรือยอดรวม)', () => {
  const s = run([item({ id: 'a', debtor: HIM, creditor: ME, amount: 200, total: 400, date: '2026-10-20' })], [
    { id: 'slip', kind: 'expense', name: 'โอนเงิน', amount: 400, date: '2026-10-20', deleted: false, updatedAt: 1 },
  ]);
  assert.equal(s.add[0].duplicate?.id, 'slip');
});

test('ไม่เสนอรายการวันที่ในอนาคต', () => {
  assert.equal(run([item({ date: '2026-10-25' })]).add.length, 0);
});
