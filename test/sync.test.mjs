// การซิงก์: ดึงเฉพาะที่เปลี่ยน (syncedAt) ซิงก์เต็มวันละครั้ง และถอยไปแบบเดิมเมื่อกฎยังไม่รองรับ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { SyncManager } from '../js/sync.js';
import { makeDefaultSettings } from '../js/model.js';

/** localStorage แยกต่อเครื่อง */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

class LocalAdapter {
  constructor() { this.rows = new Map(); this.settings = makeDefaultSettings(); }
  async getAll() { return [...this.rows.values()]; }
  async put(tx) { this.rows.set(tx.id, tx); }
  async putMany(txs) { for (const t of txs) this.rows.set(t.id, t); }
  async delete(id) { const t = this.rows.get(id); if (t) this.rows.set(id, { ...t, deleted: true, updatedAt: Date.now() }); }
  async getSettings() { return this.settings; }
  async saveSettings(s) { this.settings = s; }
}

/** Firestore ปลอม: นับจำนวนเอกสารที่อ่าน และเลือกได้ว่ากฎรู้จัก syncedAt หรือยัง */
class FakeCloud {
  constructor() { this.rows = new Map(); this.clock = 1_000_000; this.reads = 0; this.rulesKnowSyncedAt = true; this.settings = null; }
  adapter() {
    const cloud = this;
    return {
      async getAll() { cloud.reads += cloud.rows.size; return [...cloud.rows.values()].map((r) => ({ ...r })); },
      async getChangedSince(ms) {
        const hits = [...cloud.rows.values()].filter((r) => r.syncedAt !== null && r.syncedAt > ms);
        cloud.reads += Math.max(1, hits.length); // คิวรีที่ไม่เจออะไรคิด 1 การอ่าน
        return hits.map((r) => ({ ...r }));
      },
      async putMany(txs, { stamp = false } = {}) {
        if (stamp && !cloud.rulesKnowSyncedAt) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
        cloud.clock += 10 * 60 * 1000; // ซิงก์แต่ละครั้งห่างกันหลายนาที
        for (const t of txs) {
          cloud.rows.set(t.id, { ...t, syncedAt: stamp ? cloud.clock : null });
        }
      },
      async getSettings() { cloud.reads += 1; return cloud.settings; },
      async saveSettings(s) { cloud.settings = { ...s }; },
    };
  }
}

async function device(cloud, uid = 'u1') {
  const ls = memoryStorage();
  globalThis.localStorage = ls;
  const store = await new Store(new LocalAdapter()).load();
  const sync = new SyncManager(store);
  sync.user = { uid, email: 'her@example.com' };
  sync.adapter = cloud.adapter();
  store.addEventListener('change', () => { globalThis.localStorage = ls; sync._queueDirty(); });
  return {
    store, sync,
    /** ทำงานในฐานะเครื่องนี้ (สลับ localStorage) */
    async run(fn) { globalThis.localStorage = ls; return fn(); },
    syncNow() { globalThis.localStorage = ls; return sync.syncNow(); },
    add(name, amount) { globalThis.localStorage = ls; return store.save({ kind: 'expense', name, amount, date: '2026-10-21' }); },
    cursor() { return JSON.parse(ls.getItem('tet:sync-cursor:v1')); },
    setCursor(patch) { ls.setItem('tet:sync-cursor:v1', JSON.stringify({ ...this.cursor(), ...patch })); },
  };
}

test('ซิงก์ครั้งแรกเต็ม ครั้งต่อไปอ่านเฉพาะที่เปลี่ยน', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  for (let i = 0; i < 200; i++) await phone.add(`รายการ ${i}`, i + 1);
  await phone.syncNow();
  assert.equal(cloud.rows.size, 200);
  await phone.syncNow(); // เต็ม (ยังไม่มีจุดอ้างอิงก่อนหน้านี้) → ได้จุดอ้างอิง
  assert.ok(phone.cursor().at > 0);

  cloud.reads = 0;
  await phone.add('ข้าวมันไก่', 50);
  await phone.syncNow();
  assert.ok(cloud.reads <= 3, `อ่านไป ${cloud.reads} เอกสาร`);
  assert.equal(cloud.rows.size, 201);
});

test('อีกเครื่องเห็นของใหม่ (รวมถึงการแก้และลบ) โดยไม่ต้องอ่านทั้งหมด', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  const ipad = await device(cloud);
  for (let i = 0; i < 100; i++) await phone.add(`รายการ ${i}`, i + 1);
  await phone.syncNow();
  await ipad.syncNow();
  await ipad.syncNow();
  await phone.syncNow();
  assert.equal(ipad.store.transactions.length, 100);

  const tx = await phone.add('กาแฟ', 45);
  const first = phone.store.transactions[0];
  await phone.run(() => phone.store.save({ ...first, amount: 999 }));
  await phone.run(() => phone.store.remove(phone.store.transactions[1].id));
  await phone.syncNow();

  cloud.reads = 0;
  await ipad.syncNow();
  assert.ok(cloud.reads <= 5, `อ่านไป ${cloud.reads} เอกสาร`);
  assert.equal(ipad.store.byId(tx.id)?.amount, 45);
  assert.equal(ipad.store.byId(first.id).amount, 999);
  assert.equal(ipad.store.byId(phone.store.transactions[1].id).deleted, true);
});

test('รายการที่แก้ตอนออฟไลน์นาน ๆ ก็ยังถึงอีกเครื่อง (เวลาเซิร์ฟเวอร์ ไม่ใช่เวลาเครื่อง)', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  const ipad = await device(cloud);
  await phone.add('เริ่ม', 1);
  await phone.syncNow(); await phone.syncNow();
  await ipad.syncNow(); await ipad.syncNow();
  // บันทึกในลิฟต์ (เวลาเครื่องเก่า) แต่ส่งขึ้นทีหลัง หลังจากที่ iPad ซิงก์ไปแล้ว
  const old = await phone.add('ข้าวในลิฟต์', 40);
  await phone.run(() => phone.store.save({ ...old, updatedAt: 5 }));
  await ipad.add('อีกเครื่อง', 10);
  await ipad.syncNow();
  await phone.syncNow();
  await ipad.syncNow();
  assert.equal(ipad.store.byId(old.id)?.name, 'ข้าวในลิฟต์');
});

test('กฎยังไม่รองรับ syncedAt: ส่งแบบเดิมได้ และดึงทั้งหมดแทน', async () => {
  const cloud = new FakeCloud();
  cloud.rulesKnowSyncedAt = false;
  const phone = await device(cloud);
  const ipad = await device(cloud);
  await phone.add('ก่อนเผยแพร่กฎ', 10);
  const result = await phone.syncNow();
  assert.equal(result.pushed, 1);
  assert.equal(phone.sync.status, 'ok');
  assert.ok(phone.cursor().legacyAt > 0);
  await ipad.syncNow();
  assert.equal(ipad.store.transactions.length, 1);

  // เผยแพร่กฎแล้ว — ครบ 6 ชั่วโมงก็กลับมาใช้ syncedAt เอง
  cloud.rulesKnowSyncedAt = true;
  phone.setCursor({ legacyAt: Date.now() - 7 * 3600 * 1000 });
  await phone.add('หลังเผยแพร่กฎ', 20);
  await phone.syncNow();
  assert.equal(phone.cursor().legacyAt, null);
  assert.ok([...cloud.rows.values()].some((r) => r.syncedAt !== null));
});

test('ซิงก์เต็มวันละครั้ง เก็บตกรายการจากแอปรุ่นเก่าที่ไม่มี syncedAt', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  await phone.add('a', 1);
  await phone.syncNow(); await phone.syncNow();
  // แอปรุ่นเก่าบนอีกเครื่องเขียนทับโดยไม่มี syncedAt
  cloud.rows.set('legacy1', { id: 'legacy1', kind: 'expense', name: 'จากรุ่นเก่า', amount: 5, type: null, group: 'DE', date: '2026-10-20', createdAt: 1, updatedAt: Date.now(), deleted: false, syncedAt: null });
  await phone.syncNow();
  assert.equal(phone.store.byId('legacy1'), null);
  phone.setCursor({ fullAt: Date.now() - 25 * 3600 * 1000 });
  await phone.syncNow();
  assert.equal(phone.store.byId('legacy1')?.name, 'จากรุ่นเก่า');
});

test('รายการที่แก้ระหว่างกำลังซิงก์ไม่หลุดคิว', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  await phone.add('a', 1);
  await phone.syncNow(); await phone.syncNow();
  const adapter = phone.sync.adapter;
  let added = null;
  phone.sync.adapter = {
    ...adapter,
    async getChangedSince(ms) {
      added = await phone.add('ระหว่างซิงก์', 7);
      return adapter.getChangedSince(ms);
    },
  };
  await phone.syncNow();
  phone.sync.adapter = adapter;
  await phone.syncNow();
  assert.equal(cloud.rows.get(added.id)?.name, 'ระหว่างซิงก์');
});

test('บัญชีอื่นในเครื่องเดียวกันไม่ใช้จุดอ้างอิงของอีกบัญชี', async () => {
  const cloud = new FakeCloud();
  const phone = await device(cloud);
  await phone.add('a', 1);
  await phone.syncNow(); await phone.syncNow();
  phone.sync.user = { uid: 'u2', email: 'x@example.com' };
  assert.equal(await phone.run(() => phone.sync._readCursor().at), null);
});
