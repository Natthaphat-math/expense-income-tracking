import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryDayISO, isLateNight } from '../js/format.js';
import { Store } from '../js/store.js';
import { makeDefaultSettings } from '../js/model.js';

test('entryDayISO: before 4am counts as the previous day', () => {
  assert.equal(entryDayISO(new Date(2026, 9, 18, 0, 30)), '2026-10-17');
  assert.equal(entryDayISO(new Date(2026, 9, 18, 3, 59)), '2026-10-17');
  assert.equal(entryDayISO(new Date(2026, 9, 18, 4, 0)), '2026-10-18');
  assert.equal(entryDayISO(new Date(2026, 9, 18, 22, 15)), '2026-10-18');
  // ข้ามเดือน/ปี
  assert.equal(entryDayISO(new Date(2027, 0, 1, 1, 0)), '2026-12-31');
  assert.equal(isLateNight(new Date(2026, 9, 18, 2, 0)), true);
  assert.equal(isLateNight(new Date(2026, 9, 18, 21, 0)), false);
});

/** adapter ในหน่วยความจำ — พฤติกรรมเดียวกับ LocalStorageAdapter (ลบแบบ soft) */
class MemoryAdapter {
  constructor() { this.rows = new Map(); this.settings = makeDefaultSettings(); }
  async getAll() { return [...this.rows.values()]; }
  async put(tx) { this.rows.set(tx.id, tx); }
  async putMany(txs) { for (const t of txs) this.rows.set(t.id, t); }
  async delete(id) { const t = this.rows.get(id); if (t) this.rows.set(id, { ...t, deleted: true, updatedAt: Date.now() }); }
  async getSettings() { return this.settings; }
  async saveSettings(s) { this.settings = s; }
}

test('revert: undoes a create, an edit and a delete', async () => {
  const store = await new Store(new MemoryAdapter()).load();
  const a = await store.save({ kind: 'expense', name: 'กาแฟ', amount: 45, date: '2026-10-18' });
  const b = await store.save({ kind: 'expense', name: 'ข้าว', amount: 50, date: '2026-10-18' });

  // แก้ไข แล้วเลิกทำ
  const beforeEdit = store.byId(a.id);
  await store.save({ ...a, type: 'ค่าเครื่องดื่ม' });
  await store.revert([{ id: a.id, before: beforeEdit }]);
  assert.equal(store.byId(a.id).type, null);
  assert.ok(store.byId(a.id).updatedAt >= beforeEdit.updatedAt, 'revert is a newer write so sync keeps it');

  // ลบ แล้วเลิกทำ
  const beforeDelete = store.byId(b.id);
  await store.remove(b.id);
  assert.equal(store.active.length, 1);
  await store.revert([{ id: b.id, before: beforeDelete }]);
  assert.equal(store.active.length, 2);

  // เพิ่มใหม่ แล้วเลิกทำ
  const c = await store.save({ kind: 'expense', name: 'ชานม', amount: 40, date: '2026-10-18' });
  await store.revert([{ id: c.id, before: null }]);
  assert.equal(store.active.some((t) => t.id === c.id), false);
});

test('frequentItems: needs two uses, suggests the usual amount', async () => {
  const store = await new Store(new MemoryAdapter()).load();
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}`;
  await store.save({ kind: 'expense', name: 'ชานม', amount: 45, date: day(10), type: 'ค่าเครื่องดื่ม' });
  await store.save({ kind: 'expense', name: 'ชานม', amount: 45, date: day(12) });
  await store.save({ kind: 'expense', name: 'ชานม', amount: 50, date: day(15) });
  await store.save({ kind: 'expense', name: 'ครั้งเดียว', amount: 99, date: day(15) });
  const items = store.frequentItems(6, day(18));
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'ชานม');
  assert.equal(items[0].amount, 45);
  assert.equal(items[0].type, 'ค่าเครื่องดื่ม');
});

test('suggestType: history first, then names that start with a category word', async () => {
  const { suggestType } = await import('../js/parser.js');
  const { DEFAULT_CATEGORIES } = await import('../js/model.js');
  const opts = (learned = null, kind = 'expense') => ({ categories: DEFAULT_CATEGORIES, kind, learned });

  // เคยตั้งไว้ → มาจากประวัติ
  const learned = new Map([['เซเว่น', 'ค่าของใช้ในบ้าน']]);
  assert.deepEqual(suggestType('เซเว่น', opts(learned)), { type: 'ค่าของใช้ในบ้าน', source: 'history' });
  // ประวัติชี้ไปประเภทของอีกฝั่ง → ไม่ใช้
  assert.equal(suggestType('เงินเดือน', opts(new Map([['เงินเดือน', 'ค่าอาหาร']]), 'income'))?.type, 'เงินเดือน');

  // ขึ้นต้นด้วยคำเรียกของประเภท
  assert.deepEqual(suggestType('ชาเขียว', opts()), { type: 'ค่าเครื่องดื่ม', source: 'guess' });
  assert.equal(suggestType('ข้าวมันไก่', opts())?.type, 'ค่าอาหาร');
  assert.equal(suggestType('กาแฟเย็น', opts())?.type, 'ค่าเครื่องดื่ม');
  // คำยาวกว่าชนะ: "ค่าเน็ต" ไม่ใช่ "ค่า..." อื่น
  assert.equal(suggestType('ค่าเน็ตบ้าน', opts())?.type, 'ค่าอินเทอร์เน็ต');

  // คำที่อยู่กลางชื่อไม่นับ — "รถไฟฟ้า" ไม่ใช่ค่าไฟฟ้า
  assert.equal(suggestType('รถไฟฟ้า', opts())?.type ?? null, null);
  assert.equal(suggestType('เค้ก', opts()), null);
});

test('untypedGroups: groups by name and side, biggest first', async () => {
  const store = await new Store(new MemoryAdapter()).load();
  for (const name of ['ไป', 'ไป ', 'ไป', 'กาแฟ']) {
    await store.save({ kind: 'expense', name, amount: 10, date: '2026-10-01' });
  }
  await store.save({ kind: 'expense', name: 'กาแฟ', amount: 45, date: '2026-10-02', type: 'ค่าเครื่องดื่ม' });
  await store.save({ kind: 'income', name: 'ไป', amount: 5, date: '2026-10-03' });
  const groups = store.untypedGroups();
  assert.deepEqual(groups.map((g) => [g.kind, g.name, g.count]), [
    ['expense', 'ไป', 3], ['income', 'ไป', 1], ['expense', 'กาแฟ', 1],
  ]);
  assert.equal(store.untypedCount, 5);
});

test('duplicates: amount tolerance, ±1 day, side, and differing categories', async () => {
  const { amountsClose, findSimilar, findImported } = await import('../js/duplicates.js');
  assert.equal(amountsClose(60, 59), true);
  assert.equal(amountsClose(1000, 1010), true);   // 5% แต่ไม่เกิน 10 บาท
  assert.equal(amountsClose(1000, 1011), false);
  assert.equal(amountsClose(30, 31.6), false);    // 5% ของ 31.6 = 1.58 < 1.6
  const slipTx = { id: 's', kind: 'expense', amount: 59, date: '2026-10-14', type: null, slipRef: '004:ABCDEF123', deleted: false };
  const manual = { id: 'm', kind: 'expense', amount: 60, date: '2026-10-15', type: 'ค่าอาหาร', deleted: false };
  const all = [slipTx, manual];
  assert.deepEqual(findSimilar(all, { kind: 'expense', amount: 60, date: '2026-10-15' }, 'slip').map((t) => t.id), ['s']);
  assert.deepEqual(findSimilar(all, { kind: 'expense', amount: 59, date: '2026-10-14' }, 'manual').map((t) => t.id), ['m']);
  assert.equal(findSimilar(all, { kind: 'expense', amount: 60, date: '2026-10-17' }, 'slip').length, 0);   // ห่าง 3 วัน
  assert.equal(findSimilar(all, { kind: 'income', amount: 60, date: '2026-10-15' }, 'slip').length, 0);    // คนละฝั่ง
  assert.equal(findSimilar(all, { kind: 'expense', amount: 59, date: '2026-10-14', type: 'ค่าเดินทาง' }, 'manual').length, 0);
  assert.equal(findSimilar(all, { kind: 'expense', amount: 15, date: '2026-10-14' }, 'manual').length, 0); // ยอดเล็กไม่เตือน
  assert.equal(findImported(all, { ref: '004:ABCDEF123' })?.id, 's');
  assert.equal(findImported(all, { ref: '004:OTHER1234', hash: null }), null);
});
