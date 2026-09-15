// การซิงก์แบบ "เครื่องมาก่อน" (offline-first)
//
// localStorage เป็นตัวหลักเสมอ: บันทึกลงเครื่องทันที แล้วค่อยส่งขึ้น Firestore
// เบื้องหลัง ถ้าไม่มีเน็ตหรือยังไม่ได้เข้าสู่ระบบ แอปก็ทำงานได้ครบทุกอย่าง
//
// การรวมข้อมูลใช้กติกาเดียวกับการนำเข้าไฟล์: id เดียวกัน ฉบับที่ updatedAt
// ใหม่กว่าชนะ (last-write-wins) — ดู mergeTransactions() ใน backup.js

import { FirestoreAdapter } from './firestore-adapter.js';
import { mergeTransactions, sanitizeTransaction, sanitizeSettings } from './backup.js';
import { currentUser, watchAuth } from './remote.js';
import { SYNC_ENABLED } from './firebase-config.js';

const QUEUE_KEY = 'tet:sync-queue:v1';
const LAST_SYNC_KEY = 'tet:last-sync:v1';

export class SyncManager extends EventTarget {
  constructor(store) {
    super();
    this.store = store;
    this.user = null;
    this.adapter = null;
    this.status = SYNC_ENABLED ? 'idle' : 'disabled';
    this.lastError = null;
    this._running = false;
    this._unwatch = null;
  }

  /** เริ่มติดตามสถานะเข้าสู่ระบบ และซิงก์ให้อัตโนมัติ */
  async start() {
    if (!SYNC_ENABLED) return;

    this._unwatch = await watchAuth((user) => {
      this.user = user;
      this.adapter = user ? new FirestoreAdapter(user.uid) : null;
      this._emit();
      if (user) this.syncNow().catch(() => {});
    });

    // เน็ตกลับมาแล้วลองส่งของที่ค้างอยู่
    globalThis.addEventListener?.('online', () => {
      if (this.user) this.syncNow().catch(() => {});
    });

    // ทุกครั้งที่ข้อมูลในเครื่องเปลี่ยน ให้จดไว้ว่าต้องส่งขึ้นไป
    this.store.addEventListener('change', () => this._queueDirty());
  }

  stop() {
    if (this._unwatch) this._unwatch();
    this._unwatch = null;
  }

  get signedIn() {
    return Boolean(this.user);
  }

  get email() {
    return this.user?.email ?? null;
  }

  get lastSyncedAt() {
    try {
      return localStorage.getItem(LAST_SYNC_KEY);
    } catch {
      return null;
    }
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('status'));
  }

  _setStatus(status, error = null) {
    this.status = status;
    this.lastError = error;
    this._emit();
  }

  // ------------------------------------------------------------- คิวรอส่ง
  _readQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  _writeQueue(ids) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...ids]));
    } catch { /* พื้นที่เต็ม — ครั้งหน้าจะซิงก์เต็มรูปแบบแทน */ }
  }

  /** จดว่ามีรายการที่แก้หลังการซิงก์ครั้งล่าสุด */
  _queueDirty() {
    const since = Number(this.lastSyncedAt ? Date.parse(this.lastSyncedAt) : 0);
    const ids = this._readQueue();
    for (const tx of this.store.transactions) {
      if ((tx.updatedAt ?? 0) > since) ids.add(tx.id);
    }
    this._writeQueue(ids);
    if (this.user && navigator.onLine !== false) {
      // หน่วงไว้เล็กน้อย เผื่อผู้ใช้กำลังบันทึกหลายรายการติดกัน
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this.syncNow().catch(() => {}), 2500);
    }
  }

  // --------------------------------------------------------------- ซิงก์
  /**
   * ดึงของจากคลาวด์มารวมกับของในเครื่อง แล้วส่งของที่ใหม่กว่าขึ้นไป
   * ปลอดภัยที่จะเรียกซ้ำ — ถ้ากำลังทำงานอยู่จะข้ามไป
   */
  async syncNow() {
    if (!SYNC_ENABLED || !this.adapter || this._running) return null;
    this._running = true;
    this._setStatus('syncing');

    try {
      const localBefore = this.store.transactions.slice();

      // 1) ดึงของจากคลาวด์ แล้วกรองเหมือนข้อมูลนำเข้า (ไม่เชื่อข้อมูลจากภายนอก)
      const remoteRaw = await this.adapter.getAll();
      const remote = remoteRaw.map(sanitizeTransaction).filter(Boolean);

      // 2) รวมเข้าด้วยกัน ฉบับใหม่กว่าชนะ
      const merged = mergeTransactions(localBefore, remote);
      if (merged.added > 0 || merged.updated > 0) {
        await this.store.setTransactions(merged.transactions);
      }

      // 3) หาว่ามีอะไรที่คลาวด์ยังไม่มี หรือในเครื่องใหม่กว่า
      const remoteById = new Map(remote.map((t) => [t.id, t]));
      const toPush = merged.transactions.filter((t) => {
        const there = remoteById.get(t.id);
        return !there || (t.updatedAt ?? 0) > (there.updatedAt ?? 0);
      });
      if (toPush.length > 0) await this.adapter.putMany(toPush);

      // 4) ตั้งค่า — ใช้กติกาเดียวกัน ฝั่งที่ updatedAt ใหม่กว่าชนะ
      await this._syncSettings();

      this._writeQueue(new Set());
      try {
        localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      } catch { /* ไม่เป็นไร */ }

      this._setStatus('ok');
      return { pulled: merged.added + merged.updated, pushed: toPush.length };
    } catch (err) {
      console.warn('ซิงก์ไม่สำเร็จ', err);
      this._setStatus('error', friendlyError(err));
      return null;
    } finally {
      this._running = false;
    }
  }

  async _syncSettings() {
    const local = this.store.settings;
    const localStamp = Number(local.updatedAt ?? 0);

    const remoteRaw = await this.adapter.getSettings();
    if (!remoteRaw) {
      await this.adapter.saveSettings({ ...local, updatedAt: localStamp || Date.now() });
      return;
    }

    const remoteStamp = Number(remoteRaw.updatedAt ?? 0);
    if (remoteStamp > localStamp) {
      const clean = sanitizeSettings(remoteRaw);
      await this.store.updateSettings({
        categories: clean.categories.length > 0 ? clean.categories : local.categories,
        budgets: clean.budgets,
        openingBalances: clean.openingBalances,
        carryOverBalance: remoteRaw.carryOverBalance !== false,
        lastBackupAt: remoteRaw.lastBackupAt ?? local.lastBackupAt,
        updatedAt: remoteStamp,
      });
    } else if (localStamp > remoteStamp) {
      await this.adapter.saveSettings(local);
    }
  }

  /** ส่งทุกอย่างขึ้นคลาวด์ครั้งแรก (ใช้ตอนเพิ่งเข้าสู่ระบบบนเครื่องที่มีข้อมูลอยู่แล้ว) */
  async pushAll() {
    if (!this.adapter) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
    this._setStatus('syncing');
    try {
      await this.adapter.putMany(this.store.transactions);
      await this.adapter.saveSettings({ ...this.store.settings, updatedAt: Date.now() });
      this._setStatus('ok');
    } catch (err) {
      this._setStatus('error', friendlyError(err));
      throw err;
    }
  }
}

/** แปลงรหัสข้อผิดพลาดของ Firebase เป็นข้อความที่อ่านรู้เรื่อง */
export function friendlyError(err) {
  const code = err?.code ?? '';
  if (code === 'permission-denied' || code === 'auth/unauthorized-domain') {
    return 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูล — ตรวจอีเมลในกฎของ Firestore อีกครั้ง';
  }
  if (code === 'unavailable' || code === 'auth/network-request-failed') {
    return 'ต่ออินเทอร์เน็ตไม่ได้ จะลองใหม่ให้อัตโนมัติ';
  }
  if (code === 'auth/invalid-email') return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (code === 'auth/invalid-action-code') {
    return 'ลิงก์นี้ใช้ไม่ได้แล้ว อาจหมดอายุหรือถูกใช้ไปแล้ว — ขอลิงก์ใหม่อีกครั้ง';
  }
  return err?.message ?? 'เกิดข้อผิดพลาดที่ไม่รู้จัก';
}
