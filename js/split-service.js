// หารกัน — เชื่อมรายการที่ใช้ร่วมกันสองคนกับ Firestore แบบเรียลไทม์
//
// ต่างจากข้อมูลส่วนตัว (localStorage เป็นหลัก ส่งขึ้นคลาวด์ทีหลัง) ตรงที่รายการนี้มีสองคนแก้
// จึงให้ Firestore เป็นตัวหลัก ใช้แคชในเครื่องของ Firestore เองตอนออฟไลน์
// และฟังการเปลี่ยนแปลงสด ๆ (onSnapshot) อีกฝ่ายเพิ่มอะไร เครื่องนี้เห็นภายในไม่กี่วินาที

import { loadFirebase, watchAuth } from './remote.js';
import { SPLIT_PAIR_ID, SYNC_ENABLED } from './firebase-config.js';
import {
  sanitizeSplit, toSplitDoc, summarizeSplits, unseenCount, isEmail, cleanNickname,
} from './split-model.js';
import { newId } from './model.js';
import { friendlyError } from './sync.js';

const SEEN_KEY = 'tet:split-seen-at';

/**
 * status:
 *   off     — ปิดการซิงก์ หรือยังไม่ได้เข้าสู่ระบบ
 *   loading — กำลังตรวจว่าบัญชีนี้อยู่ในคู่ไหม
 *   none    — บัญชีนี้ไม่ได้อยู่ในคู่ (หรือยังไม่ได้ตั้งค่าคู่ใน console)
 *   ready   — พร้อมใช้
 *   error   — มีปัญหา ดู lastError
 */
export class SplitService extends EventTarget {
  constructor() {
    super();
    this.status = 'off';
    this.lastError = null;
    this.me = null;
    this.members = [];
    this.names = [];
    this.owner = null;
    this.entries = [];
    /** อีเมลคนตั้ง → ชื่อที่คนนั้นใช้เรียกอีกฝ่าย */
    this.nicknames = {};
    this.pending = false;
    this._unsub = null;
    this._settled = Promise.resolve();
    this._resolveSettled = null;
  }

  async start() {
    if (!SYNC_ENABLED) return;
    this._beginLoading();
    await watchAuth((user) => { this._onUser(user).catch((err) => this._fail(err)); });
  }

  /** รอจนรู้แล้วว่าบัญชีที่เข้าสู่ระบบอยู่เป็นใครในคู่ (หรือไม่อยู่) */
  whenSettled() {
    return this._settled;
  }

  /** 'owner' = เจ้าของแอป, 'partner' = อีกคน (เห็นแค่หารกัน), null = ไม่ได้อยู่ในคู่ */
  get role() {
    if (this.status !== 'ready' || !this.me) return null;
    return this.me === this.owner ? 'owner' : 'partner';
  }

  get partner() {
    return this.members.find((m) => m !== this.me) ?? null;
  }

  /**
   * ชื่อที่แสดงบนเครื่องนี้: ตัวเองเป็น "ฉัน" อีกฝ่ายใช้ชื่อเล่นที่เราตั้งให้
   * ไม่มีก็ใช้ชื่อในเอกสารคู่ แล้วค่อยเป็นส่วนหน้าของอีเมล
   */
  nameOf(email) {
    if (email && email === this.me) return 'ฉัน';
    if (email && email === this.partner && this.nicknames[this.me]) return this.nicknames[this.me];
    return this.pairName(email);
  }

  /** ชื่อตั้งต้นจากเอกสารคู่ (ที่ตั้งใน console) */
  pairName(email) {
    const name = this.names[this.members.indexOf(email)];
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 40);
    return email ? email.split('@')[0] : '';
  }

  summary() {
    return summarizeSplits(this.entries, this.me);
  }

  /** ชื่อเล่นที่ฉันตั้งให้อีกฝ่าย / ที่อีกฝ่ายตั้งให้ฉัน */
  get myNickname() {
    return this.nicknames[this.me] ?? null;
  }

  get nicknameForMe() {
    return this.nicknames[this.partner] ?? null;
  }

  /** ตั้งชื่อเล่นให้อีกฝ่าย — ว่าง = กลับไปใช้ชื่อเดิม */
  async setNickname(value) {
    const fb = await loadFirebase();
    if (!fb || this.status !== 'ready') throw new Error('ยังเชื่อมต่อหารกันไม่ได้');
    const { doc, setDoc, deleteDoc } = fb.storeMod;
    const ref = doc(fb.db, 'pairs', SPLIT_PAIR_ID, 'nicknames', this.me);
    const name = cleanNickname(value);
    const write = name ? setDoc(ref, { name, updatedAt: Date.now() }) : deleteDoc(ref);
    write.catch((err) => {
      this.lastError = friendlyError(err);
      this.dispatchEvent(new CustomEvent('write-error', { detail: this.lastError }));
    });
  }

  get unseen() {
    return unseenCount(this.entries, this.me, this.seenAt());
  }

  markSeen() {
    const latest = Math.max(0, ...this.entries.map((e) => e.updatedAt));
    try { localStorage.setItem(SEEN_KEY, String(latest)); } catch { /* ไม่เป็นไร */ }
  }

  seenAt() {
    try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
  }

  // ------------------------------------------------------------ เชื่อมต่อ
  _beginLoading() {
    this._settled = new Promise((resolve) => { this._resolveSettled = resolve; });
  }

  _finishLoading() {
    this._resolveSettled?.();
    this._resolveSettled = null;
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  _fail(err) {
    console.warn('หารกัน: เชื่อมต่อไม่สำเร็จ', err);
    this.status = 'error';
    this.lastError = friendlyError(err);
    this._finishLoading();
    this._emit();
  }

  async _onUser(user) {
    this._unsub?.();
    this._unsub = null;
    this.entries = [];
    this.nicknames = {};
    this.lastError = null;
    if (!this._resolveSettled) this._beginLoading();

    if (!user?.email) {
      this.status = 'off';
      this.me = null;
      this._finishLoading();
      this._emit();
      return;
    }

    this.me = user.email.toLowerCase();
    this.status = 'loading';
    this._emit();

    const fb = await loadFirebase();
    if (!fb) throw new Error('ต่ออินเทอร์เน็ตไม่ได้');
    const { doc, getDoc, collection, onSnapshot } = fb.storeMod;

    let pair;
    try {
      const snap = await getDoc(doc(fb.db, 'pairs', SPLIT_PAIR_ID));
      pair = snap.exists() ? snap.data() : null;
    } catch (err) {
      // ไม่ได้อยู่ในคู่ = กฎปฏิเสธการอ่าน — เป็นเรื่องปกติของบัญชีที่ไม่ได้ใช้หารกัน
      if (err?.code === 'permission-denied') pair = null;
      else throw err;
    }

    const members = Array.isArray(pair?.members) ? pair.members.filter(isEmail).map((m) => m.toLowerCase()) : [];
    if (members.length !== 2 || !members.includes(this.me)) {
      this.status = 'none';
      this._finishLoading();
      this._emit();
      return;
    }
    this.members = members;
    this.names = Array.isArray(pair.names) ? pair.names.map((n) => (typeof n === 'string' ? n : '')) : [];
    this.owner = typeof pair.owner === 'string' ? pair.owner.toLowerCase() : null;

    // includeMetadataChanges: รู้ด้วยว่าการเขียนที่รอส่ง ส่งถึงเซิร์ฟเวอร์แล้ว (ข้อมูลไม่เปลี่ยนแต่สถานะเปลี่ยน)
    // ไม่ใส่แล้วป้าย "ยังรอส่ง" จะค้างอยู่ทั้งที่ส่งไปแล้ว
    const stopSplits = onSnapshot(collection(fb.db, 'pairs', SPLIT_PAIR_ID, 'splits'), { includeMetadataChanges: true }, (snap) => {
      this.entries = snap.docs.map((d) => sanitizeSplit(d.data(), this.members)).filter(Boolean);
      this.pending = snap.metadata.hasPendingWrites;
      this.status = 'ready';
      this._finishLoading();
      this._emit();
    }, (err) => this._fail(err));
    const stopNicknames = onSnapshot(collection(fb.db, 'pairs', SPLIT_PAIR_ID, 'nicknames'), (snap) => {
      const next = {};
      for (const d of snap.docs) {
        const setter = d.id.toLowerCase();
        const name = cleanNickname(d.data()?.name);
        // รับเฉพาะของสองคนในคู่ — ข้อมูลจาก Firestore ถือว่าไม่น่าเชื่อถือเสมอ
        if (name && this.members.includes(setter)) next[setter] = name;
      }
      this.nicknames = next;
      if (this.status === 'ready') this._emit();
    }, (err) => console.warn('หารกัน: อ่านชื่อเล่นไม่ได้', err));
    this._unsub = () => { stopSplits(); stopNicknames(); };
  }

  // ------------------------------------------------------------ เขียน
  /**
   * บันทึกหลายรายการพร้อมกัน — ไม่ต้องรอเซิร์ฟเวอร์ตอบ
   * แคชในเครื่องอัปเดตทันที (หน้าจอเปลี่ยนเลย) แล้วค่อยส่งเมื่อมีเน็ต
   */
  async save(entries) {
    const fb = await loadFirebase();
    if (!fb || this.status !== 'ready') throw new Error('ยังเชื่อมต่อหารกันไม่ได้');
    const { doc, writeBatch } = fb.storeMod;
    const batch = writeBatch(fb.db);
    const now = Date.now();
    for (const entry of entries) {
      batch.set(doc(fb.db, 'pairs', SPLIT_PAIR_ID, 'splits', entry.id), toSplitDoc(entry, this.me, now));
    }
    batch.commit().catch((err) => {
      // ส่งไม่ผ่าน (เช่นกฎปฏิเสธ) — แคชจะถอยกลับเอง แจ้งให้รู้
      this.lastError = friendlyError(err);
      this.dispatchEvent(new CustomEvent('write-error', { detail: this.lastError }));
    });
  }

  /** ร่างรายการใหม่ (ยังไม่บันทึก) */
  draft(fields) {
    return {
      id: newId(),
      total: null,
      name: '',
      settled: false,
      settledBy: null,
      settledAt: null,
      deleted: false,
      createdBy: this.me,
      createdAt: Date.now(),
      ...fields,
    };
  }

  byId(id) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /** ย้อนกลับ — entries = [{ id, before }] (before null = เพิ่งสร้าง ให้ลบแบบ soft) */
  revert(undo) {
    const restore = undo.map(({ id, before }) => (before
      ? { ...before }
      : { ...this.byId(id), deleted: true })).filter((e) => e && e.id);
    return this.save(restore);
  }
}
