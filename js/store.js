// สถานะกลางของแอป — ห่อ storage adapter ไว้อีกชั้น
// หน้าจอทุกหน้าอ่าน/เขียนผ่านที่นี่ ไม่แตะ adapter ตรง ๆ

import {
  makeTransaction,
  summarize,
  groupForCategory,
  defaultGroupFor,
} from './model.js';
import { monthKeyOf, previousMonthKey, todayISO } from './format.js';
import { buildLearnedTypes } from './parser.js';

export class Store extends EventTarget {
  constructor(adapter) {
    super();
    this.adapter = adapter;
    this.transactions = [];
    this.settings = null;
    this._learned = null;
  }

  async load() {
    const [txs, settings] = await Promise.all([this.adapter.getAll(), this.adapter.getSettings()]);
    this.transactions = txs;
    this.settings = settings;
    this._learned = null;
    return this;
  }

  _changed() {
    this._learned = null;
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** รายการที่ยังไม่ถูกลบ */
  get active() {
    return this.transactions.filter((t) => !t.deleted);
  }

  /** ตารางชื่อรายการ -> ประเภทที่ใช้ล่าสุด (สร้างครั้งเดียวแล้วจำไว้) */
  get learnedTypes() {
    if (!this._learned) this._learned = buildLearnedTypes(this.transactions);
    return this._learned;
  }

  byId(id) {
    return this.transactions.find((t) => t.id === id) ?? null;
  }

  byDate(iso) {
    return this.active
      .filter((t) => t.date === iso)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  byMonth(key) {
    return this.active
      .filter((t) => monthKeyOf(t.date) === key)
      .sort((a, b) => (a.date === b.date ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : b.date.localeCompare(a.date)));
  }

  byYear(year) {
    const prefix = String(year);
    return this.active.filter((t) => t.date.startsWith(prefix));
  }

  /** ปีที่มีข้อมูล เรียงจากใหม่ไปเก่า — ถ้ายังไม่มีเลยให้ปีปัจจุบัน */
  get yearsWithData() {
    const years = new Set(this.active.map((t) => Number(t.date.slice(0, 4))));
    years.add(Number(todayISO().slice(0, 4)));
    return [...years].sort((a, b) => b - a);
  }

  /** เติมกลุ่มจากประเภทให้อัตโนมัติ — ผู้ใช้ไม่ต้องรู้จักรหัสกลุ่มเลย */
  prepare(input) {
    const kind = input.kind === 'income' ? 'income' : 'expense';
    const group = input.group || (input.type
      ? groupForCategory(this.settings, input.type, kind)
      : defaultGroupFor(kind));
    return makeTransaction({ ...input, kind, group });
  }

  async save(input) {
    const tx = this.prepare(input);
    await this.adapter.put(tx);
    const index = this.transactions.findIndex((t) => t.id === tx.id);
    if (index >= 0) this.transactions[index] = tx;
    else this.transactions.push(tx);
    this._changed();
    return tx;
  }

  async saveMany(inputs) {
    const txs = inputs.map((i) => this.prepare(i));
    await this.adapter.putMany(txs);
    const byId = new Map(this.transactions.map((t) => [t.id, t]));
    for (const tx of txs) byId.set(tx.id, tx);
    this.transactions = [...byId.values()];
    this._changed();
    return txs;
  }

  async remove(id) {
    await this.adapter.delete(id);
    const index = this.transactions.findIndex((t) => t.id === id);
    if (index >= 0) {
      this.transactions[index] = { ...this.transactions[index], deleted: true, updatedAt: Date.now() };
    }
    this._changed();
  }

  async replaceTransactions(txs) {
    if (typeof this.adapter.replaceAll === 'function') {
      this.transactions = await this.adapter.replaceAll(txs);
    } else {
      await this.adapter.putMany(txs);
      this.transactions = txs;
    }
    this._changed();
  }

  async setTransactions(txs) {
    await this.adapter.putMany(txs);
    this.transactions = txs;
    this._changed();
  }

  async updateSettings(patch) {
    // ประทับเวลาไว้เพื่อให้การซิงก์รู้ว่าฝั่งไหนใหม่กว่า
    // ถ้า patch ระบุ updatedAt มาเอง (เช่นตอนรับค่าจากคลาวด์) ให้ใช้ค่านั้น
    const updatedAt = patch.updatedAt ?? Date.now();
    this.settings = { ...this.settings, ...patch, updatedAt };
    await this.adapter.saveSettings(this.settings);
    this._changed();
    return this.settings;
  }

  /** ยอดเริ่มต้นของเดือน: ค่าที่ตั้งไว้เอง ไม่งั้นยกยอดคงเหลือจากเดือนก่อน */
  openingBalance(key) {
    const explicit = this.settings.openingBalances?.[key];
    if (typeof explicit === 'number') return explicit;
    if (!this.settings.carryOverBalance) return 0;
    return this.carriedBalance(key);
  }

  /** ยอดคงเหลือปลายเดือนก่อนหน้า (ไล่ย้อนได้สูงสุด 36 เดือน กันวนไม่รู้จบ) */
  carriedBalance(key, depth = 0) {
    if (depth > 36) return 0;
    const previous = previousMonthKey(key);
    const rows = this.byMonth(previous);
    const explicit = this.settings.openingBalances?.[previous];
    const hasHistory = rows.length > 0 || typeof explicit === 'number';
    if (!hasHistory) return 0;
    const start = typeof explicit === 'number' ? explicit : this.carriedBalance(previous, depth + 1);
    const { income, expense } = summarize(rows);
    return Math.round((start + income - expense) * 100) / 100;
  }

  monthSummary(key) {
    const rows = this.byMonth(key);
    const totals = summarize(rows);
    const opening = this.openingBalance(key);
    return {
      ...totals,
      rows,
      opening,
      remaining: Math.round((opening + totals.income - totals.expense) * 100) / 100,
      hasExplicitOpening: typeof this.settings.openingBalances?.[key] === 'number',
    };
  }

  yearSummary(year) {
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const rows = this.byMonth(key);
      months.push({ key, month: m, ...summarize(rows), count: rows.length });
    }
    const totals = summarize(this.byYear(year));
    const december = `${year}-12`;
    const opening = this.openingBalance(`${year}-01`);
    return {
      year,
      months,
      ...totals,
      opening,
      remaining: Math.round((opening + totals.income - totals.expense) * 100) / 100,
      lastKey: december,
    };
  }

  /** เพิ่มประเภทใหม่ถ้ายังไม่มี คืน true เมื่อเพิ่งเพิ่ม */
  async addCategory(name, group) {
    const clean = String(name ?? '').trim().slice(0, 100);
    if (!clean) return false;
    if (this.settings.categories.some((c) => c.name === clean)) return false;
    const categories = [...this.settings.categories, { name: clean, group, aliases: [], archived: false }];
    await this.updateSettings({ categories });
    return true;
  }

  /** เปลี่ยนชื่อประเภท พร้อมอัปเดตรายการเดิมทั้งหมด */
  async renameCategory(oldName, newName) {
    const clean = String(newName ?? '').trim().slice(0, 100);
    if (!clean || clean === oldName) return 0;

    const categories = this.settings.categories.map((c) =>
      c.name === oldName ? { ...c, name: clean } : c);

    const budgets = {
      defaults: renameKey(this.settings.budgets.defaults, oldName, clean),
      months: Object.fromEntries(
        Object.entries(this.settings.budgets.months).map(([k, table]) => [k, renameKey(table, oldName, clean)]),
      ),
    };

    const touched = [];
    this.transactions = this.transactions.map((t) => {
      if (t.type !== oldName) return t;
      const next = { ...t, type: clean, updatedAt: Date.now() };
      touched.push(next);
      return next;
    });
    if (touched.length > 0) await this.adapter.putMany(touched);
    await this.updateSettings({ categories, budgets });
    return touched.length;
  }

  async setCategoryGroup(name, group) {
    const categories = this.settings.categories.map((c) => (c.name === name ? { ...c, group } : c));
    const kind = group === 'IN' ? 'income' : 'expense';
    const touched = [];
    this.transactions = this.transactions.map((t) => {
      if (t.type !== name) return t;
      const next = { ...t, group, kind, updatedAt: Date.now() };
      touched.push(next);
      return next;
    });
    if (touched.length > 0) await this.adapter.putMany(touched);
    await this.updateSettings({ categories });
    return touched.length;
  }

  async setCategoryArchived(name, archived) {
    const categories = this.settings.categories.map((c) =>
      c.name === name ? { ...c, archived: archived === true } : c);
    await this.updateSettings({ categories });
  }

  async setCategoryAliases(name, aliases) {
    const clean = aliases
      .map((a) => String(a).trim())
      .filter((a) => a.length > 0)
      .slice(0, 50);
    const categories = this.settings.categories.map((c) =>
      c.name === name ? { ...c, aliases: clean } : c);
    await this.updateSettings({ categories });
  }

  /** ตั้งงบ: scope 'default' คือทุกเดือนต่อจากนี้, 'month' คือเฉพาะเดือนนั้น */
  async setBudget(categoryName, value, { scope = 'default', monthKey = null } = {}) {
    const amount = Number(value);
    const clean = Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
    const budgets = {
      defaults: { ...this.settings.budgets.defaults },
      months: { ...this.settings.budgets.months },
    };
    if (scope === 'month' && monthKey) {
      budgets.months[monthKey] = { ...(budgets.months[monthKey] ?? {}), [categoryName]: clean };
    } else {
      budgets.defaults[categoryName] = clean;
      // ลบ override ของเดือนนี้ เพื่อให้ค่าเริ่มต้นใหม่มีผลทันที
      if (monthKey && budgets.months[monthKey]) {
        const { [categoryName]: _removed, ...rest } = budgets.months[monthKey];
        if (Object.keys(rest).length > 0) budgets.months[monthKey] = rest;
        else delete budgets.months[monthKey];
      }
    }
    await this.updateSettings({ budgets });
  }

  async setOpeningBalance(key, value) {
    const openingBalances = { ...this.settings.openingBalances };
    if (value === null) delete openingBalances[key];
    else {
      const n = Number(value);
      openingBalances[key] = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    }
    await this.updateSettings({ openingBalances });
  }
}

function renameKey(table, oldName, newName) {
  if (!table || !(oldName in table)) return { ...table };
  const { [oldName]: value, ...rest } = table;
  return { ...rest, [newName]: value };
}
