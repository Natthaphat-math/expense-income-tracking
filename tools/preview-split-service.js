// หารกันจำลองสำหรับพรีวิวเท่านั้น — ไม่มี Firebase ในพรีวิว
// ใช้ตรรกะคำนวณจริง (split-model.js) แต่เก็บรายการไว้ในหน่วยความจำ ชื่อและอีเมลสมมติทั้งหมด

import {
  sanitizeSplit, toSplitDoc, summarizeSplits, unseenCount,
} from '../js/split-model.js';
import { newId } from '../js/model.js';
import { todayISO, addDays } from '../js/format.js';

const ME = 'mali@example.com';
const THEM = 'ton@example.com';

export class SplitService extends EventTarget {
  constructor() {
    super();
    this.status = 'ready';
    this.lastError = null;
    this.me = ME;
    this.members = [ME, THEM];
    this.names = ['มะลิ', 'ต้น'];
    this.owner = ME;
    this.pending = false;
    const t = todayISO();
    const base = Date.now() - 86400000 * 3;
    const make = (n, fields) => sanitizeSplit(toSplitDoc({
      id: `demo${n}`, total: null, settled: false, deleted: false, createdAt: base + n * 1000, ...fields,
    }, fields.createdBy, base + n * 1000), this.members);
    this.entries = [
      make(1, { kind: 'item', debtor: ME, creditor: THEM, amount: 50, name: 'ข้าวผัดกะเพรา', date: addDays(t, -2), createdBy: THEM }),
      make(2, { kind: 'item', debtor: THEM, creditor: ME, amount: 150, total: 300, name: 'หมูกระทะ', date: addDays(t, -1), createdBy: ME }),
      make(3, { kind: 'item', debtor: ME, creditor: THEM, amount: 35, name: 'ค่าวินมอเตอร์ไซค์', date: t, createdBy: THEM }),
    ];
  }

  async start() { this.dispatchEvent(new CustomEvent('change')); }
  whenSettled() { return Promise.resolve(); }
  get role() { return 'owner'; }
  get partner() { return THEM; }
  nameOf(email) { return this.names[this.members.indexOf(email)] ?? ''; }
  summary() { return summarizeSplits(this.entries, ME); }
  get unseen() { return unseenCount(this.entries, ME, this._seen ?? 0); }
  markSeen() { this._seen = Math.max(0, ...this.entries.map((e) => e.updatedAt)); }
  byId(id) { return this.entries.find((e) => e.id === id) ?? null; }

  draft(fields) {
    return { id: newId(), total: null, name: '', settled: false, settledBy: null, settledAt: null,
      deleted: false, createdBy: ME, createdAt: Date.now(), ...fields };
  }

  async save(list) {
    for (const entry of list) {
      const clean = sanitizeSplit(toSplitDoc(entry, ME), this.members);
      if (!clean) continue;
      const i = this.entries.findIndex((e) => e.id === clean.id);
      if (i >= 0) this.entries[i] = clean;
      else this.entries.push(clean);
    }
    setTimeout(() => this.dispatchEvent(new CustomEvent('change')), 0);
  }

  revert(undo) {
    return this.save(undo.map(({ id, before }) => (before ? { ...before } : { ...this.byId(id), deleted: true })));
  }
}
