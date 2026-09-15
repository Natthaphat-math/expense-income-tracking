// ทดสอบการตรวจไฟล์นำเข้า — ถือว่าไฟล์ที่นำเข้าไม่น่าเชื่อถือเสมอ
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBackup, sanitizeTransaction, sanitizeSettings,
  mergeTransactions, mergeCategories, buildBackup, backupFilename,
} from '../js/backup.js';

const goodTx = {
  id: 'a1', kind: 'expense', name: 'ก๋วยเตี๋ยว', amount: 20, type: 'ค่าอาหาร',
  group: 'DE', date: '2026-01-15', createdAt: 1767225600000, updatedAt: 1767225600000, deleted: false,
};

const wrap = (transactions, settings = {}) => ({
  app: 'thai-expense-tracker', schemaVersion: 1, exportedAt: '2026-01-15T10:00:00+07:00',
  settings, transactions,
});

test('ไฟล์ที่ถูกต้องผ่าน', () => {
  const r = validateBackup(wrap([goodTx]));
  assert.equal(r.ok, true);
  assert.equal(r.transactions.length, 1);
  assert.deepEqual(r.transactions[0], goodTx);
});

test('ปฏิเสธไฟล์จากแอปอื่นและรุ่นที่ไม่รองรับ', () => {
  assert.equal(validateBackup({ ...wrap([goodTx]), app: 'other-app' }).ok, false);
  assert.equal(validateBackup({ ...wrap([goodTx]), schemaVersion: 99 }).ok, false);
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([]).ok, false);
  assert.equal(validateBackup('ข้อความ').ok, false);
  assert.equal(validateBackup({ app: 'thai-expense-tracker', schemaVersion: 1 }).ok, false);
});

test('ข้อความอันตรายถูกเก็บเป็นข้อความธรรมดา ไม่ใช่โค้ด', () => {
  const nasty = '<img src=x onerror=alert(1)>';
  const r = validateBackup(wrap([{ ...goodTx, name: nasty, type: `<script>alert(2)</script>` }]));
  assert.equal(r.ok, true);
  // ตัวตรวจไม่แก้เนื้อข้อความ — ความปลอดภัยมาจากการใส่ด้วย textContent ตอนแสดงผล
  assert.equal(r.transactions[0].name, nasty);
  assert.equal(typeof r.transactions[0].type, 'string');
});

test('ชนิดข้อมูลผิดถูกตัดทิ้ง', () => {
  const rows = [
    { ...goodTx, id: 'b1', name: '' },                  // ชื่อว่าง
    { ...goodTx, id: 'b2', name: 123 },                 // ชื่อไม่ใช่ข้อความ
    { ...goodTx, id: 'b3', date: '15/01/2026' },        // รูปแบบวันที่ผิด
    { ...goodTx, id: 'b4', date: '2026-13-45' },        // วันที่ไม่มีจริง
    { ...goodTx, id: 'b5', group: 'XX' },               // กลุ่มไม่รู้จัก
    { ...goodTx, id: 'b6', amount: -5 },                // ติดลบ
    { ...goodTx, id: 'b7', amount: 1e12 },              // เกินช่วง
    { ...goodTx, id: 'b8', amount: 'มาก' },             // ไม่ใช่ตัวเลข
    { ...goodTx, id: 'b9', amount: Infinity },
    { ...goodTx, id: 'b10', type: { evil: true } },     // ประเภทเป็นวัตถุ
    { ...goodTx, id: 'b11', kind: 'transfer' },         // ชนิดไม่รู้จัก
    null, 'ข้อความ', 42, [],
  ];
  const r = validateBackup(wrap([goodTx, ...rows]));
  assert.equal(r.transactions.length, 1, 'เหลือเฉพาะรายการที่ถูกต้อง');
  assert.equal(r.stats.skipped, rows.length);
});

test('kind ถูกปรับให้ตรงกับกลุ่มเสมอ', () => {
  const r = validateBackup(wrap([
    { ...goodTx, id: 'c1', kind: 'income', group: 'DE' },
    { ...goodTx, id: 'c2', kind: 'expense', group: 'IN' },
    { ...goodTx, id: 'c3', kind: 'expense', group: 'SV' },
  ]));
  assert.deepEqual(r.transactions.map((t) => [t.group, t.kind]), [
    ['DE', 'expense'], ['IN', 'income'], ['SV', 'expense'],
  ]);
});

test('มูลค่าว่างถูกเก็บเป็น null ได้', () => {
  const r = validateBackup(wrap([{ ...goodTx, amount: null }, { ...goodTx, id: 'd2', amount: undefined }]));
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].amount, null);
  assert.equal(r.transactions[1].amount, null);
});

test('id ซ้ำถูกตัดทิ้ง และชื่อยาวเกินถูกตัดสั้น', () => {
  const r = validateBackup(wrap([goodTx, { ...goodTx, name: 'อีกอัน' }]));
  assert.equal(r.transactions.length, 1);

  const long = validateBackup(wrap([{ ...goodTx, name: 'ก'.repeat(500) }]));
  assert.equal(long.transactions[0].name.length, 200);
});

test('เวลานอกช่วงถูกแทนด้วยเวลาปัจจุบัน', () => {
  const r = validateBackup(wrap([
    { ...goodTx, createdAt: -1, updatedAt: 'เมื่อวาน' },
  ]));
  const tx = r.transactions[0];
  assert.equal(Number.isInteger(tx.createdAt), true);
  assert.equal(Number.isInteger(tx.updatedAt), true);
  assert.ok(tx.createdAt > 946684800000);
});

test('ตั้งค่าที่ผิดรูปแบบถูกกรองออก', () => {
  const s = sanitizeSettings({
    categories: [
      { name: 'ค่าอาหาร', group: 'DE', aliases: ['ข้าว'], archived: false },
      { name: 'ผิดกลุ่ม', group: 'ZZ', aliases: [], archived: false },
      { name: '', group: 'DE' },
      { name: 'ค่าอาหาร', group: 'SD' },                 // ชื่อซ้ำ
      { name: 'นามแฝงพัง', group: 'DE', aliases: 'ไม่ใช่ลิสต์' },
      'ไม่ใช่วัตถุ', null,
    ],
    budgets: {
      defaults: { ค่าอาหาร: 5000, ติดลบ: -1, ไม่ใช่เลข: 'มาก', เกิน: 1e12 },
      months: { '2026-01': { ค่าอาหาร: 4000 }, 'ไม่ใช่เดือน': { x: 1 } },
    },
    openingBalances: { '2026-01': 100, 'พังพัง': 5, '2026-02': 'มาก' },
  });

  assert.deepEqual(s.categories.map((c) => c.name), ['ค่าอาหาร', 'นามแฝงพัง']);
  assert.deepEqual(s.categories[1].aliases, []);
  assert.deepEqual(s.budgets.defaults, { ค่าอาหาร: 5000 });
  assert.deepEqual(Object.keys(s.budgets.months), ['2026-01']);
  assert.deepEqual(s.openingBalances, { '2026-01': 100 });
});

test('ตั้งค่าที่เป็นค่าแปลก ๆ ไม่ทำให้พัง', () => {
  for (const bad of [null, undefined, 'ข้อความ', 42, []]) {
    const s = sanitizeSettings(bad);
    assert.deepEqual(s.categories, []);
    assert.deepEqual(s.budgets.months, {});
  }
});

test('__proto__ ในไฟล์ไม่ไปแตะ Object.prototype', () => {
  const payload = JSON.parse('{"app":"thai-expense-tracker","schemaVersion":1,"transactions":[],"settings":{"budgets":{"defaults":{"__proto__":{"polluted":true}}},"openingBalances":{}}}');
  const r = validateBackup(payload);
  assert.equal(r.ok === true || r.ok === false, true);
  assert.equal({}.polluted, undefined, 'prototype ต้องไม่ถูกแก้');
});

test('รวมข้อมูล: ฉบับที่ updatedAt ใหม่กว่าชนะ', () => {
  const existing = [{ ...goodTx, name: 'ของเดิม', updatedAt: 100 }];
  const incoming = [
    { ...goodTx, name: 'ของใหม่', updatedAt: 200 },
    { ...goodTx, id: 'zz', name: 'รายการใหม่', updatedAt: 50 },
  ];
  const r = mergeTransactions(existing, incoming);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.transactions.find((t) => t.id === 'a1').name, 'ของใหม่');
});

test('รวมข้อมูล: ฉบับที่เก่ากว่าไม่ทับของเดิม', () => {
  const existing = [{ ...goodTx, name: 'ของเดิม', updatedAt: 500 }];
  const r = mergeTransactions(existing, [{ ...goodTx, name: 'ของเก่า', updatedAt: 100 }]);
  assert.equal(r.updated, 0);
  assert.equal(r.unchanged, 1);
  assert.equal(r.transactions[0].name, 'ของเดิม');
});

test('รวมประเภท: ของเดิมในเครื่องมาก่อน', () => {
  const r = mergeCategories(
    [{ name: 'ค่าอาหาร', group: 'DE', aliases: ['ข้าว'], archived: false }],
    [{ name: 'ค่าอาหาร', group: 'SD', aliases: [], archived: true },
     { name: 'ค่าใหม่', group: 'DE', aliases: [], archived: false }],
  );
  assert.equal(r.added, 1);
  assert.equal(r.categories.find((c) => c.name === 'ค่าอาหาร').group, 'DE');
});

test('ส่งออกแล้วนำเข้ากลับได้ครบ', () => {
  const settings = {
    categories: [{ name: 'ค่าอาหาร', group: 'DE', aliases: ['ข้าว'], archived: false }],
    budgets: { defaults: { ค่าอาหาร: 5000 }, months: { '2026-01': { ค่าอาหาร: 4000 } } },
    openingBalances: { '2026-01': 1000 },
  };
  const file = buildBackup([goodTx], settings);
  const round = validateBackup(JSON.parse(JSON.stringify(file)));
  assert.equal(round.ok, true);
  assert.deepEqual(round.transactions, [goodTx]);
  assert.deepEqual(round.settings.categories, settings.categories);
  assert.deepEqual(round.settings.budgets, settings.budgets);
  assert.deepEqual(round.settings.openingBalances, settings.openingBalances);
});

test('ชื่อไฟล์สำรองมีวันที่', () => {
  assert.equal(backupFilename('2026-09-15'), 'tracker-backup-2026-09-15.json');
});
