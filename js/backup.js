// นำเข้า / ส่งออกไฟล์สำรอง
// ข้อมูลที่นำเข้าถือว่า "ไม่น่าเชื่อถือ" — ตรวจ schema, ชนิด และช่วงค่าให้ครบก่อนบันทึก

import { GROUP_CODES, MAX_AMOUNT, MAX_NAME, isGroupCode, newId } from './model.js';
import { isValidISODate, todayISO } from './format.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'thai-expense-tracker';

const MAX_TRANSACTIONS = 200000;
const MAX_CATEGORIES = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** สร้างเนื้อไฟล์สำรอง */
export function buildBackup(transactions, settings) {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      categories: settings.categories,
      budgets: settings.budgets,
      openingBalances: settings.openingBalances,
    },
    transactions,
  };
}

export function backupFilename(today = todayISO()) {
  return `tracker-backup-${today}.json`;
}

/**
 * ตรวจและทำความสะอาดไฟล์ที่นำเข้า
 * @returns {{ ok: boolean, errors: string[], warnings: string[], transactions: [], settings: {}|null, stats: {} }}
 */
export function validateBackup(raw) {
  const errors = [];
  const warnings = [];
  const result = {
    ok: false,
    errors,
    warnings,
    transactions: [],
    settings: null,
    stats: { transactions: 0, categories: 0, skipped: 0 },
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('ไฟล์นี้ไม่ใช่ข้อมูลสำรองของแอป');
    return result;
  }
  if (raw.app !== APP_ID) {
    errors.push(`ไฟล์นี้มาจากแอปอื่น (app = ${shortString(raw.app)})`);
    return result;
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`รุ่นของข้อมูลไม่ตรงกัน (ไฟล์เป็นรุ่น ${shortString(raw.schemaVersion)} แอปรองรับรุ่น ${SCHEMA_VERSION})`);
    return result;
  }
  if (!Array.isArray(raw.transactions)) {
    errors.push('ไม่พบรายการในไฟล์');
    return result;
  }
  if (raw.transactions.length > MAX_TRANSACTIONS) {
    errors.push(`ไฟล์มีรายการมากเกินไป (${raw.transactions.length.toLocaleString('th-TH')} รายการ)`);
    return result;
  }

  const seen = new Set();
  let skipped = 0;
  for (const item of raw.transactions) {
    const tx = sanitizeTransaction(item);
    if (!tx) {
      skipped += 1;
      continue;
    }
    if (seen.has(tx.id)) {
      skipped += 1;
      continue;
    }
    seen.add(tx.id);
    result.transactions.push(tx);
  }
  if (skipped > 0) {
    warnings.push(`ข้าม ${skipped.toLocaleString('th-TH')} รายการที่ข้อมูลไม่ครบหรือผิดรูปแบบ`);
  }

  result.settings = sanitizeSettings(raw.settings, warnings);
  result.stats = {
    transactions: result.transactions.length,
    categories: result.settings?.categories.length ?? 0,
    skipped,
  };
  result.ok = result.transactions.length > 0 || result.stats.categories > 0;
  if (!result.ok) errors.push('ไม่พบข้อมูลที่ใช้ได้ในไฟล์นี้');
  return result;
}

/** คืน transaction ที่สะอาดแล้ว หรือ null ถ้าใช้ไม่ได้ */
export function sanitizeTransaction(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const id = typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64 ? item.id : newId();

  const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_NAME) : '';
  if (name.length === 0) return null;

  if (!isValidISODate(item.date)) return null;

  const group = isGroupCode(item.group) ? item.group : null;
  if (!group) return null;

  const kind = item.kind === 'income' || item.kind === 'expense' ? item.kind : null;
  if (!kind) return null;
  // kind ต้องสอดคล้องกับกลุ่ม: IN คือรายรับ กลุ่มอื่นคือรายจ่าย
  const expectedKind = group === 'IN' ? 'income' : 'expense';

  let amount = null;
  if (item.amount !== null && item.amount !== undefined) {
    const n = Number(item.amount);
    if (!Number.isFinite(n) || n < 0 || n >= MAX_AMOUNT) return null;
    amount = Math.round(n * 100) / 100;
  }

  let type = null;
  if (item.type !== null && item.type !== undefined) {
    if (typeof item.type !== 'string') return null;
    const trimmed = item.type.trim().slice(0, 100);
    type = trimmed.length > 0 ? trimmed : null;
  }

  const createdAt = safeStamp(item.createdAt);
  const updatedAt = safeStamp(item.updatedAt, createdAt);

  return {
    id,
    kind: expectedKind,
    name,
    amount,
    type,
    group,
    date: item.date,
    createdAt,
    updatedAt,
    deleted: item.deleted === true,
  };
}

function safeStamp(value, fallback = Date.now()) {
  const n = Number(value);
  // ช่วงที่ยอมรับ: ปี 2000 ถึงปี 2100
  if (!Number.isFinite(n) || n < 946684800000 || n > 4102444800000) return fallback;
  return Math.round(n);
}

function shortString(value) {
  return String(value ?? '').slice(0, 40);
}

export function sanitizeSettings(raw, warnings = []) {
  const categories = [];
  const seenNames = new Set();

  if (raw && Array.isArray(raw.categories)) {
    for (const item of raw.categories.slice(0, MAX_CATEGORIES)) {
      if (!item || typeof item !== 'object') continue;
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 100) : '';
      if (!name || seenNames.has(name)) continue;
      if (!isGroupCode(item.group)) continue;
      seenNames.add(name);
      const aliases = Array.isArray(item.aliases)
        ? item.aliases
            .filter((a) => typeof a === 'string' && a.trim().length > 0)
            .map((a) => a.trim().slice(0, 100))
            .slice(0, 50)
        : [];
      categories.push({ name, group: item.group, aliases, archived: item.archived === true });
    }
  }

  const budgets = {
    defaults: sanitizeAmountMap(raw?.budgets?.defaults),
    months: {},
  };
  const months = raw?.budgets?.months;
  if (months && typeof months === 'object' && !Array.isArray(months)) {
    for (const [key, table] of Object.entries(months).slice(0, 600)) {
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const clean = sanitizeAmountMap(table);
      if (Object.keys(clean).length > 0) budgets.months[key] = clean;
    }
  }

  const openingBalances = {};
  const opening = raw?.openingBalances;
  if (opening && typeof opening === 'object' && !Array.isArray(opening)) {
    for (const [key, value] of Object.entries(opening).slice(0, 600)) {
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      const n = Number(value);
      if (Number.isFinite(n) && Math.abs(n) < MAX_AMOUNT) openingBalances[key] = n;
    }
  }

  if (raw && !Array.isArray(raw.categories)) {
    warnings.push('ไฟล์นี้ไม่มีรายการประเภท — จะใช้ประเภทเดิมในเครื่อง');
  }

  return { categories, budgets, openingBalances };
}

function sanitizeAmountMap(table) {
  const out = {};
  if (!table || typeof table !== 'object' || Array.isArray(table)) return out;
  for (const [name, value] of Object.entries(table).slice(0, MAX_CATEGORIES)) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 100) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n >= MAX_AMOUNT) continue;
    out[name.slice(0, 100)] = Math.round(n * 100) / 100;
  }
  return out;
}

/** รวมข้อมูล: id เดียวกันให้ updatedAt ใหม่กว่าชนะ */
export function mergeTransactions(existing, incoming) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const tx of incoming) {
    const current = byId.get(tx.id);
    if (!current) {
      byId.set(tx.id, tx);
      added += 1;
    } else if ((tx.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
      byId.set(tx.id, tx);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  return { transactions: [...byId.values()], added, updated, unchanged };
}

/** รวมประเภท: ของเดิมในเครื่องมาก่อน เพิ่มเฉพาะชื่อที่ยังไม่มี */
export function mergeCategories(existing, incoming) {
  const byName = new Map(existing.map((c) => [c.name, c]));
  let added = 0;
  for (const cat of incoming) {
    if (byName.has(cat.name)) continue;
    byName.set(cat.name, cat);
    added += 1;
  }
  return { categories: [...byName.values()], added };
}

export function parseBackupFile(text) {
  if (typeof text !== 'string') throw new Error('อ่านไฟล์ไม่ได้');
  if (text.length > MAX_FILE_BYTES) throw new Error('ไฟล์ใหญ่เกินไป');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง');
  }
  return validateBackup(parsed);
}
