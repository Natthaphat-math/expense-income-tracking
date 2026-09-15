// FirestoreAdapter — มีเมธอดชุดเดียวกับ LocalStorageAdapter
//
// ใช้เดี่ยว ๆ ก็ได้ (new Store(new FirestoreAdapter(uid))) แต่ในแอปนี้ถูกใช้
// ผ่าน SyncManager เพื่อให้ localStorage เป็นตัวหลัก และแอปไม่พังเมื่อเน็ตหาย
//
// ที่อยู่ข้อมูล: users/{uid}/transactions/{id} และ users/{uid}/meta/settings

import { loadFirebase } from './remote.js';

/** ฟิลด์ที่กฎใน Firestore ยอมรับ — ส่งเกินไปกฎจะปฏิเสธทั้งเอกสาร */
const TX_FIELDS = ['id', 'kind', 'name', 'amount', 'type', 'group', 'date', 'createdAt', 'updatedAt', 'deleted'];

/** ตัดให้เหลือเฉพาะฟิลด์ที่กฎอนุญาต และให้ชนิดตรงตามที่กฎตรวจ */
export function toFirestoreDoc(tx) {
  const doc = {};
  for (const key of TX_FIELDS) doc[key] = tx[key] ?? null;
  doc.amount = typeof tx.amount === 'number' ? tx.amount : null;
  doc.type = typeof tx.type === 'string' && tx.type.length > 0 ? tx.type : null;
  // กฎกำหนดว่าสองช่องนี้ต้องเป็น int
  doc.createdAt = Math.round(Number(tx.createdAt) || Date.now());
  doc.updatedAt = Math.round(Number(tx.updatedAt) || Date.now());
  doc.deleted = tx.deleted === true;
  return doc;
}

export class FirestoreAdapter {
  constructor(uid) {
    this.uid = uid;
  }

  async _fb() {
    const fb = await loadFirebase();
    if (!fb) throw new Error('เชื่อมต่อ Firebase ไม่ได้');
    return fb;
  }

  _txCollection(fb) {
    return fb.storeMod.collection(fb.db, 'users', this.uid, 'transactions');
  }

  _settingsDoc(fb) {
    return fb.storeMod.doc(fb.db, 'users', this.uid, 'meta', 'settings');
  }

  async getAll() {
    const fb = await this._fb();
    const snapshot = await fb.storeMod.getDocs(this._txCollection(fb));
    return snapshot.docs.map((d) => d.data());
  }

  async put(tx) {
    const fb = await this._fb();
    await fb.storeMod.setDoc(
      fb.storeMod.doc(this._txCollection(fb), tx.id),
      toFirestoreDoc(tx),
    );
    return tx;
  }

  /** เขียนทีละชุด — Firestore จำกัด batch ละ 500 การเขียน */
  async putMany(txs) {
    if (txs.length === 0) return txs;
    const fb = await this._fb();
    const collection = this._txCollection(fb);

    for (let i = 0; i < txs.length; i += 450) {
      const slice = txs.slice(i, i + 450);
      const batch = fb.storeMod.writeBatch(fb.db);
      for (const tx of slice) {
        batch.set(fb.storeMod.doc(collection, tx.id), toFirestoreDoc(tx));
      }
      await batch.commit();
    }
    return txs;
  }

  /** ลบแบบนุ่ม เหมือนฝั่งเครื่อง เพื่อให้เครื่องอื่นรู้ว่าถูกลบ */
  async delete(id) {
    const fb = await this._fb();
    const ref = fb.storeMod.doc(this._txCollection(fb), id);
    const snapshot = await fb.storeMod.getDoc(ref);
    if (!snapshot.exists()) return;
    await fb.storeMod.setDoc(ref, toFirestoreDoc({
      ...snapshot.data(), deleted: true, updatedAt: Date.now(),
    }));
  }

  async getSettings() {
    const fb = await this._fb();
    const snapshot = await fb.storeMod.getDoc(this._settingsDoc(fb));
    return snapshot.exists() ? snapshot.data() : null;
  }

  async saveSettings(settings) {
    const fb = await this._fb();
    await fb.storeMod.setDoc(this._settingsDoc(fb), {
      categories: settings.categories ?? [],
      budgets: settings.budgets ?? { defaults: {}, months: {} },
      openingBalances: settings.openingBalances ?? {},
      carryOverBalance: settings.carryOverBalance !== false,
      lastBackupAt: settings.lastBackupAt ?? null,
      updatedAt: Math.round(Number(settings.updatedAt) || Date.now()),
    });
    return settings;
  }
}
