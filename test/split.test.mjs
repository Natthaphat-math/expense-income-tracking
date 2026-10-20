// ทดสอบการคำนวณหารกัน — อีเมลสมมติทั้งหมด
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSplits, sanitizeSplit, toSplitDoc, unseenCount } from '../js/split-model.js';

const A = 'a@example.com';
const B = 'b@example.com';
const MEMBERS = [A, B];
let n = 0;
const T0 = 1790000000000;

/** a จ่ายแทน b (b ค้าง a) */
function item(debtor, creditor, amount, date, extra = {}) {
  n += 1;
  return { id: `i${n}`, kind: 'item', debtor, creditor, amount, total: null, name: `ของ ${n}`, date,
    settled: false, settledBy: null, settledAt: null, createdBy: creditor, createdAt: T0 + n, updatedAt: T0 + n, updatedBy: creditor, deleted: false, ...extra };
}
function pay(debtor, creditor, amount, date, extra = {}) {
  n += 1;
  return { ...item(debtor, creditor, amount, date), id: `p${n}`, kind: 'payment', name: '', createdBy: debtor, updatedBy: debtor, ...extra };
}

test('one direction: the other person owes the sum of open items', () => {
  const s = summarizeSplits([item(B, A, 50, '2026-10-01'), item(B, A, 120, '2026-10-02')], A);
  assert.equal(s.net, 170);
  assert.equal(summarizeSplits([item(B, A, 50, '2026-10-01')], B).net, -50);
  assert.equal(s.open.length, 2);
  assert.equal(s.open[0].date, '2026-10-02'); // ใหม่สุดก่อน
});

test('partial repayment covers the oldest items first', () => {
  const old = item(B, A, 50, '2026-10-01');
  const mid = item(B, A, 120, '2026-10-02');
  const p = pay(B, A, 100, '2026-10-03');
  const s = summarizeSplits([old, mid, p], A);
  assert.equal(s.net, 70);
  assert.equal(s.history.find((h) => h.id === old.id)?.clearedBy, 'payment');
  const m = s.open.find((o) => o.id === mid.id);
  assert.equal(m.remaining, 70);
  assert.equal(m.partly, true);
  // การโอน 100 หักหมดแล้ว (50 + 50 ของรายการที่สอง) จึงย้ายไปประวัติ
  assert.equal(s.history.find((h) => h.id === p.id)?.clearedBy, 'used');
  assert.ok(!s.open.some((o) => o.id === p.id));
});

test('a payment larger than the items stays open with what is left', () => {
  const it = item(B, A, 30, '2026-10-01');
  const p = pay(B, A, 50, '2026-10-02');
  const s = summarizeSplits([it, p], A);
  assert.equal(s.net, -20);
  assert.equal(s.open.find((o) => o.id === p.id)?.remaining, 20);
});

test('both directions net out; overpayment flips who owes', () => {
  const s = summarizeSplits([item(B, A, 300, '2026-10-01'), item(A, B, 50, '2026-10-02')], A);
  assert.equal(s.net, 250);
  const over = summarizeSplits([item(B, A, 300, '2026-10-01'), pay(B, A, 500, '2026-10-02')], A);
  assert.equal(over.net, -200);
});

test('ticked items and payments no longer count; deleted ones vanish', () => {
  const s = summarizeSplits([
    item(B, A, 50, '2026-10-01', { settled: true, settledBy: A, settledAt: T0 + 99 }),
    item(B, A, 80, '2026-10-02', { deleted: true }),
    pay(B, A, 30, '2026-10-03', { settled: true, settledBy: B, settledAt: T0 + 98 }),
    item(B, A, 20, '2026-10-04'),
  ], A);
  assert.equal(s.net, 20);
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].settledAt, T0 + 99);
});

test('decimals stay exact to the satang', () => {
  const s = summarizeSplits([item(B, A, 10.1, '2026-10-01'), item(B, A, 20.2, '2026-10-01'), pay(B, A, 0.3, '2026-10-02')], A);
  assert.equal(s.net, 30);
});

test('sanitize: rejects anything outside the pair or malformed', () => {
  const good = toSplitDoc(item(B, A, 50, '2026-10-01'), A, T0 + 1000);
  assert.ok(sanitizeSplit(good, MEMBERS));
  assert.equal(sanitizeSplit({ ...good, debtor: 'x@evil.com' }, MEMBERS), null);
  assert.equal(sanitizeSplit({ ...good, debtor: A }, MEMBERS), null);            // ตัวเองค้างตัวเอง
  assert.equal(sanitizeSplit({ ...good, amount: -5 }, MEMBERS), null);
  assert.equal(sanitizeSplit({ ...good, amount: '50' }, MEMBERS), null);
  assert.equal(sanitizeSplit({ ...good, total: 10 }, MEMBERS), null);            // ยอดรวมน้อยกว่าส่วนที่ค้าง
  assert.equal(sanitizeSplit({ ...good, name: '  ' }, MEMBERS), null);           // รายการต้องมีชื่อ
  assert.equal(sanitizeSplit({ ...good, kind: 'loan' }, MEMBERS), null);
  assert.equal(sanitizeSplit({ ...good, id: '../x' }, MEMBERS), null);
  assert.equal(sanitizeSplit({ ...good, createdBy: 'x@evil.com' }, MEMBERS), null);
  assert.ok(sanitizeSplit({ ...toSplitDoc(pay(B, A, 20, '2026-10-02'), B, T0 + 1), name: '' }, MEMBERS));
});

test('toSplitDoc: stamps who changed it; settling records who and when', () => {
  const d = toSplitDoc({ ...item(B, A, 50, '2026-10-01'), settled: true, settledBy: null, settledAt: null }, B, T0 + 500);
  assert.equal(d.updatedBy, B);
  assert.equal(d.settledBy, B);
  assert.equal(d.settledAt, T0 + 500);
  const reopened = toSplitDoc({ ...d, settled: false }, A, T0 + 600);
  assert.equal(reopened.settledBy, null);
  assert.equal(reopened.settledAt, null);
});

test('unseen: counts only the other person\'s changes since last look', () => {
  const list = [item(B, A, 10, '2026-10-01', { updatedBy: B, updatedAt: T0 + 10 }), item(B, A, 10, '2026-10-01', { updatedBy: A, updatedAt: T0 + 20 })];
  assert.equal(unseenCount(list, A, T0), 1);
  assert.equal(unseenCount(list, A, T0 + 15), 0);
});

test('nickname: trimmed, control characters removed, 30 characters max, empty means none', async () => {
  const { cleanNickname } = await import('../js/split-model.js');
  assert.equal(cleanNickname('  ที่รัก  '), 'ที่รัก');
  assert.equal(cleanNickname('หมี\u0000พูห์\n'), 'หมีพูห์');
  assert.equal(cleanNickname('a   b'), 'a b');
  assert.equal(cleanNickname('x'.repeat(40)).length, 30);
  assert.equal(cleanNickname('   '), null);
  assert.equal(cleanNickname(42), null);
  assert.equal(cleanNickname('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'.slice(0, 30)); // แสดงผลด้วย textContent เสมอ
});

test('settledAs: paid by default, forgiven kept, absent on open items', () => {
  const open = toSplitDoc(item(B, A, 50, '2026-10-01'), A, T0 + 1);
  assert.equal('settledAs' in open, false);
  const paid = toSplitDoc({ ...item(B, A, 50, '2026-10-01'), settled: true }, A, T0 + 2);
  assert.equal(paid.settledAs, 'paid');
  const forgiven = toSplitDoc({ ...item(B, A, 50, '2026-10-01'), settled: true, settledAs: 'forgiven' }, A, T0 + 3);
  assert.equal(forgiven.settledAs, 'forgiven');
  assert.equal(sanitizeSplit(forgiven, MEMBERS).settledAs, 'forgiven');
  // ของเก่าที่เคลียร์ก่อนมีฟิลด์นี้ = โอนแล้ว
  const legacy = { ...paid };
  delete legacy.settledAs;
  assert.equal(sanitizeSplit(legacy, MEMBERS).settledAs, 'paid');
  assert.equal(sanitizeSplit({ ...forgiven, settledAs: 'stolen' }, MEMBERS).settledAs, 'paid');
});
