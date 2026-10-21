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
/** { uid, at, fullAt, legacyAt } — at = syncedAt ล่าสุดที่เห็น (ไมโครวินาที ตามเวลาเซิร์ฟเวอร์) */
const CURSOR_KEY = 'tet:sync-cursor:v1';
/** ซิงก์เต็มวันละครั้ง เก็บตกสิ่งที่การดึงเฉพาะส่วนที่เปลี่ยนอาจพลาด (เช่นเขียนจากแอปรุ่นเก่า) */
const FULL_EVERY = 24 * 60 * 60 * 1000;
/** กฎยังไม่รู้จัก syncedAt — ลองใหม่ทุก 6 ชั่วโมง (เผื่อเพิ่งเผยแพร่กฎ) */
const LEGACY_RETRY = 6 * 60 * 60 * 1000;
/** กลับมาที่แอปแล้วซิงก์ ถ้าซิงก์ครั้งก่อนนานกว่านี้ */
const RESUME_SYNC_AFTER = 60 * 1000;

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
    /**
     * ถามก่อนซิงก์ข้อมูลส่วนตัวทุกครั้ง — บัญชีของอีกคนในหารกันไม่มีข้อมูลส่วนตัวบนคลาวด์
     * (กฎไม่อนุญาต) จึงต้องข้าม ไม่งั้นจะขึ้นข้อผิดพลาดค้างไว้ (ตั้งค่าใน main.js)
     */
    this.allowPersonal = async () => true;
    /** id → updatedAt ของรายการตอนเปิดแอป/ครั้งก่อนที่ดู ใช้หาว่าอะไรเปลี่ยน */
    this._known = new Map(store.transactions.map((t) => [t.id, t.updatedAt]));
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
    // แอปบนหน้าจอโฮมของ iPhone ไม่ได้บอก "online" ทุกครั้ง — กลับมาที่แอปเมื่อไหร่ก็ซิงก์ด้วย
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.user) return;
      const last = Date.parse(this.lastSyncedAt ?? '') || 0;
      if (Date.now() - last > RESUME_SYNC_AFTER) this.syncNow().catch(() => {});
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

  _readCursor() {
    try {
      const raw = JSON.parse(localStorage.getItem(CURSOR_KEY) ?? 'null');
      // บัญชีอื่นในเครื่องเดียวกัน — เริ่มใหม่
      if (raw && raw.uid === this.user?.uid) return raw;
    } catch { /* เริ่มใหม่ */ }
    return { at: null, fullAt: 0, legacyAt: null };
  }

  _writeCursor(cursor) {
    try {
      localStorage.setItem(CURSOR_KEY, JSON.stringify({ ...cursor, uid: this.user?.uid ?? null }));
    } catch { /* ครั้งหน้าซิงก์เต็มแทน */ }
  }

  /** จดว่ามีรายการที่แก้หลังการซิงก์ครั้งล่าสุด */
  _queueDirty() {
    // เทียบกับฉบับที่เห็นครั้งก่อน ไม่ใช่เวลาเครื่อง — รายการที่ updatedAt เก่า (เช่นนำเข้าจากไฟล์สำรอง) ก็ติดคิวด้วย
    this._known ??= new Map();
    const ids = this._readQueue();
    for (const tx of this.store.transactions) {
      if (this._known.get(tx.id) !== tx.updatedAt) {
        ids.add(tx.id);
        this._known.set(tx.id, tx.updatedAt);
      }
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
    if (!(await this.allowPersonal())) {
      this._setStatus('shared-only');
      return { pulled: 0, pushed: 0, skipped: true };
    }
    this._running = true;
    this._setStatus('syncing');

    try {
      const queue = this._readQueue();
      const cursor = this._readCursor();
      const legacy = cursor.legacyAt && Date.now() - cursor.legacyAt < LEGACY_RETRY;
      // ดึงทั้งหมดเมื่อ: ยังไม่เคยมีจุดอ้างอิง, ครบวัน, หรือกฎยังไม่รองรับ syncedAt
      const full = !cursor.at || legacy || Date.now() - (cursor.fullAt ?? 0) > FULL_EVERY;

      // 1) ดึงของจากคลาวด์ แล้วกรองเหมือนข้อมูลนำเข้า (ไม่เชื่อข้อมูลจากภายนอก)
      const remoteRaw = full ? await this.adapter.getAll() : await this.adapter.getChangedSince(cursor.at);
      const remote = remoteRaw.map(sanitizeTransaction).filter(Boolean);
      const seenAt = Math.max(cursor.at ?? 0, ...remoteRaw.map((d) => d.syncedAt ?? 0));
      // อ่านของในเครื่อง "หลัง" ดึงเสร็จ — รายการที่บันทึกระหว่างรอเน็ตจะได้ไม่หาย
      const localBefore = this.store.transactions.slice();
      for (const id of this._readQueue()) queue.add(id);

      // 2) รวมเข้าด้วยกัน ฉบับใหม่กว่าชนะ
      const merged = mergeTransactions(localBefore, remote);
      if (merged.added > 0 || merged.updated > 0) {
        await this.store.setTransactions(merged.transactions);
      }

      // 3) หาว่ามีอะไรที่คลาวด์ยังไม่มี หรือในเครื่องใหม่กว่า
      //    ซิงก์เต็ม: เทียบกับของบนคลาวด์ทุกรายการ / ซิงก์เฉพาะส่วน: ส่งรายการที่จดไว้ว่าแก้ในเครื่อง
      const remoteById = new Map(remote.map((t) => [t.id, t]));
      const toPush = merged.transactions.filter((t) => {
        const there = remoteById.get(t.id);
        if (there) return (t.updatedAt ?? 0) > (there.updatedAt ?? 0);
        return full || queue.has(t.id);
      });
      let legacyAt = legacy ? cursor.legacyAt : null;
      if (toPush.length > 0) {
        if (legacy) {
          await this.adapter.putMany(toPush, { compat: true });
        } else {
          try {
            await this.adapter.putMany(toPush, { stamp: true });
          } catch (err) {
            // ยังไม่ได้เผยแพร่กฎรุ่นใหม่ — ส่งแบบเดิมไปก่อน แล้วใช้การซิงก์เต็มจนกว่ากฎจะพร้อม
            if (err?.code !== 'permission-denied') throw err;
            legacyAt = Date.now();
            await this.adapter.putMany(toPush, { compat: true });
          }
        }
      }
      this._writeCursor({ at: seenAt || null, fullAt: full ? Date.now() : cursor.fullAt, legacyAt });

      // 4) ตั้งค่า — ใช้กติกาเดียวกัน ฝั่งที่ updatedAt ใหม่กว่าชนะ
      await this._syncSettings();

      // ล้างคิวเฉพาะที่จัดการแล้ว — รายการที่แก้ระหว่างซิงก์ยังอยู่ในคิว ส่งรอบหน้า
      const handled = new Map(merged.transactions.map((t) => [t.id, t.updatedAt]));
      const current = new Map(this.store.transactions.map((t) => [t.id, t.updatedAt]));
      this._writeQueue(new Set([...this._readQueue()].filter((id) => current.get(id) !== handled.get(id))));
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
    return 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลส่วนตัว — ถ้าเป็นเจ้าของ ตรวจอีเมลในกฎของ Firestore; '
      + 'ถ้าใช้เฉพาะหารกัน ตรวจว่ามีเอกสาร pairs/main และอีเมลนี้อยู่ใน members (ตัวพิมพ์เล็ก) แล้วปิดเปิดแอปใหม่';
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
