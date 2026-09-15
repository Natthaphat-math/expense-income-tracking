// ชั้นเก็บข้อมูล — UI คุยกับ interface นี้เท่านั้น
//
// เฟส 2 จะเพิ่ม FirestoreAdapter ที่ implement เมธอดชุดเดียวกัน
// (users/{uid}/transactions/{id} และ users/{uid}/meta/settings)
// แล้วสลับใน main.js ได้เลยโดยไม่ต้องแก้หน้าจอไหน
//
// สัญญาของ adapter:
//   getAll()              -> Promise<Transaction[]>   (รวมรายการที่ deleted ด้วย)
//   put(tx)               -> Promise<Transaction>
//   putMany(txs)          -> Promise<Transaction[]>
//   delete(id)            -> Promise<void>            (soft delete: deleted=true)
//   getSettings()         -> Promise<Settings>
//   saveSettings(s)       -> Promise<Settings>
//
// ทุกเมธอดคืน Promise เสมอ แม้ LocalStorageAdapter จะทำงานแบบ sync
// เพื่อให้ UI เขียนแบบ await ไว้ตั้งแต่ตอนนี้

import { makeDefaultSettings } from './model.js';

const KEY_TX = 'tet:transactions:v1';
const KEY_SETTINGS = 'tet:settings:v1';

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export class LocalStorageAdapter {
  constructor(store = globalThis.localStorage) {
    this.store = store;
    this._cache = null;
  }

  _read(key, fallback) {
    try {
      const raw = this.store.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch (err) {
      console.warn('อ่านข้อมูลไม่สำเร็จ', key, err);
      return fallback;
    }
  }

  _write(key, value) {
    try {
      this.store.setItem(key, JSON.stringify(value));
    } catch (err) {
      // โควตาเต็ม หรือโหมดส่วนตัวของ Safari
      throw new StorageError('บันทึกข้อมูลลงเครื่องไม่สำเร็จ พื้นที่เก็บข้อมูลอาจเต็ม', err);
    }
  }

  async getAll() {
    if (!this._cache) {
      const rows = this._read(KEY_TX, []);
      this._cache = Array.isArray(rows) ? rows : [];
    }
    return this._cache.slice();
  }

  async put(tx) {
    await this.getAll();
    const index = this._cache.findIndex((t) => t.id === tx.id);
    if (index >= 0) this._cache[index] = tx;
    else this._cache.push(tx);
    this._write(KEY_TX, this._cache);
    return tx;
  }

  async putMany(txs) {
    await this.getAll();
    const byId = new Map(this._cache.map((t) => [t.id, t]));
    for (const tx of txs) byId.set(tx.id, tx);
    this._cache = [...byId.values()];
    this._write(KEY_TX, this._cache);
    return txs;
  }

  /** ลบแบบนุ่ม — เก็บ id ไว้เพื่อให้ sync ในอนาคตรู้ว่าถูกลบ */
  async delete(id) {
    await this.getAll();
    const index = this._cache.findIndex((t) => t.id === id);
    if (index >= 0) {
      this._cache[index] = { ...this._cache[index], deleted: true, updatedAt: Date.now() };
      this._write(KEY_TX, this._cache);
    }
  }

  /** แทนที่ข้อมูลทั้งหมด (ใช้ตอนนำเข้าแบบแทนที่) */
  async replaceAll(txs) {
    this._cache = txs.slice();
    this._write(KEY_TX, this._cache);
    return this._cache.slice();
  }

  async getSettings() {
    const stored = this._read(KEY_SETTINGS, null);
    return mergeSettings(makeDefaultSettings(), stored);
  }

  async saveSettings(settings) {
    this._write(KEY_SETTINGS, settings);
    return settings;
  }
}

/** รวมค่าที่เก็บไว้เข้ากับค่าตั้งต้น เพื่อให้ฟิลด์ใหม่ในอนาคตไม่หายไป */
export function mergeSettings(defaults, stored) {
  if (!stored || typeof stored !== 'object') return defaults;
  return {
    ...defaults,
    ...stored,
    categories: Array.isArray(stored.categories) ? stored.categories : defaults.categories,
    budgets: {
      defaults: { ...(stored.budgets?.defaults ?? {}) },
      months: { ...(stored.budgets?.months ?? {}) },
    },
    openingBalances: { ...(stored.openingBalances ?? {}) },
  };
}
