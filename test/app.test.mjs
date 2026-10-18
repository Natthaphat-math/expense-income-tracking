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
