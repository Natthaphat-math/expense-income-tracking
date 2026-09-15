// โครงข้อมูลกลางของแอป: กลุ่มรายการ, ประเภท, งบ, และตัวช่วยคำนวณ

export const GROUPS = [
  { code: 'IN', label: 'รายได้', kind: 'income', targetWord: 'เป้าหมาย' },
  { code: 'DE', label: 'รายจ่ายประจำวัน', kind: 'expense', targetWord: 'งบ' },
  { code: 'SD', label: 'ค่ารายเดือน / ค่าหนี้', kind: 'expense', targetWord: 'งบ' },
  { code: 'IV', label: 'การลงทุน', kind: 'expense', targetWord: 'งบ' },
  { code: 'SV', label: 'การออมเงิน', kind: 'expense', targetWord: 'เป้าหมาย' },
];

export const GROUP_CODES = GROUPS.map((g) => g.code);
export const EXPENSE_GROUPS = ['DE', 'SD', 'IV', 'SV'];
/** กลุ่มที่มี "งบ" จริง ๆ — การออมเงินใช้คำว่าเป้าหมายและแสดงแยก */
export const BUDGET_GROUPS = ['DE', 'SD', 'IV'];

const GROUP_BY_CODE = new Map(GROUPS.map((g) => [g.code, g]));

export function groupLabel(code) {
  return GROUP_BY_CODE.get(code)?.label ?? code;
}

export function groupKind(code) {
  return GROUP_BY_CODE.get(code)?.kind ?? 'expense';
}

export function targetWord(code) {
  return GROUP_BY_CODE.get(code)?.targetWord ?? 'งบ';
}

export function isGroupCode(code) {
  return GROUP_BY_CODE.has(code);
}

export function defaultGroupFor(kind) {
  return kind === 'income' ? 'IN' : 'DE';
}

/** กลุ่มที่เลือกได้สำหรับ kind หนึ่ง ๆ */
export function groupsForKind(kind) {
  return GROUPS.filter((g) => g.kind === kind).map((g) => g.code);
}

export const MAX_NAME = 200;
export const MAX_AMOUNT = 100000000;

/**
 * ประเภทตั้งต้น — ชุดกลาง ๆ ให้เริ่มใช้ได้ทันที ไม่ได้อิงข้อมูลของใครคนใดคนหนึ่ง
 * แก้ เพิ่ม หรือเก็บเข้าคลังได้ที่หน้าตั้งค่า
 * ถ้านำเข้าไฟล์แบบ "แทนที่ทั้งหมด" ชุดนี้จะถูกแทนด้วยประเภทจากไฟล์
 */
export const DEFAULT_CATEGORIES = [
  { name: 'เงินเดือน', group: 'IN', aliases: ['เงินเดิอน'] },
  { name: 'รายได้เสริม', group: 'IN', aliases: ['งานเสริม', 'ฟรีแลนซ์'] },
  { name: 'เงินปันผล', group: 'IN', aliases: ['ปันผล', 'ดอกเบี้ย'] },
  { name: 'รายได้อื่น ๆ', group: 'IN', aliases: [] },

  { name: 'ค่าอาหาร', group: 'DE', aliases: ['อาหาร', 'ข้าว', 'กิน'] },
  { name: 'ค่าเดินทาง', group: 'DE', aliases: ['เดินทาง', 'รถเมล์', 'ค่ารถ', 'แท็กซี่', 'วิน', 'น้ำมัน'] },
  { name: 'ค่าเครื่องดื่ม', group: 'DE', aliases: ['เครื่องดื่ม', 'น้ำ', 'ชา', 'กาแฟ', 'น้ำหวาน'] },
  { name: 'ค่าของหวาน', group: 'DE', aliases: ['ของหวาน', 'ขนม'] },
  { name: 'ค่าผลไม้', group: 'DE', aliases: ['ผลไม้'] },

  { name: 'ค่าน้ำ', group: 'SD', aliases: ['ค่าน้ำประปา', 'ประปา'] },
  { name: 'ค่าไฟฟ้า', group: 'SD', aliases: ['ค่าไฟ', 'ไฟฟ้า'] },
  { name: 'ค่าโทรศัพท์', group: 'SD', aliases: ['โทรศัพท์', 'ค่ามือถือ'] },
  { name: 'ค่าอินเทอร์เน็ต', group: 'SD', aliases: ['ค่าเน็ต', 'เน็ต', 'อินเทอร์เน็ต'] },
  { name: 'ค่าที่พัก', group: 'SD', aliases: ['ค่าเช่า', 'ค่าหอ', 'ค่าบ้าน'] },
  { name: 'ค่าสมาชิกรายเดือน', group: 'SD', aliases: ['ค่าสมาชิก', 'subscription'] },
  { name: 'ค่าของใช้ในบ้าน', group: 'SD', aliases: ['ของใช้', 'ข้าวของ'] },
  { name: 'ค่าช็อปปิ้ง', group: 'SD', aliases: ['ช็อปปิ้ง', 'ชอปปิง', 'เสื้อผ้า'] },
  { name: 'ค่าของขวัญ', group: 'SD', aliases: ['ของขวัญ'] },
  { name: 'ค่ารักษาพยาบาล', group: 'SD', aliases: ['ค่ายา', 'หมอ', 'โรงพยาบาล'] },
  { name: 'ทำบุญ', group: 'SD', aliases: ['บริจาค'] },
  { name: 'ค่าท่องเที่ยว', group: 'SD', aliases: ['เที่ยว', 'ท่องเที่ยว'] },

  { name: 'ซื้อหุ้น', group: 'IV', aliases: ['หุ้น'] },
  { name: 'ซื้อกองทุนรวม', group: 'IV', aliases: ['กองทุนรวม', 'กองทุน'] },
  { name: 'ซื้อทอง', group: 'IV', aliases: ['ทอง'] },
  { name: 'ซื้อคอร์สเรียน', group: 'IV', aliases: ['คอร์สเรียน', 'คอร์ส'] },
  { name: 'ซื้อหนังสือ', group: 'IV', aliases: ['หนังสือ'] },

  { name: 'เงินออมฉุกเฉิน', group: 'SV', aliases: ['ฉุกเฉิน', 'เงินสำรอง'] },
  { name: 'เก็บเงินเที่ยว', group: 'SV', aliases: ['เก็บเที่ยว'] },
  { name: 'ออมระยะยาว', group: 'SV', aliases: ['ออมยาว'] },
];

/**
 * ไม่ตั้งงบเริ่มต้นมาให้ — งบเป็นเรื่องส่วนตัวของแต่ละคน
 * ตั้งเองได้ที่หน้าตั้งค่า หรือให้มาพร้อมไฟล์ที่นำเข้า
 */
export const DEFAULT_BUDGETS = {};

export function makeDefaultSettings() {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, aliases: [...c.aliases], archived: false })),
    budgets: { defaults: { ...DEFAULT_BUDGETS }, months: {} },
    openingBalances: {},
    carryOverBalance: true,
    lastBackupAt: null,
  };
}

/** งบของประเภทหนึ่งในเดือนหนึ่ง: override ของเดือนนั้นมาก่อน แล้วค่อยค่าเริ่มต้น */
export function budgetFor(settings, monthKey, categoryName) {
  const months = settings?.budgets?.months ?? {};
  const override = months[monthKey]?.[categoryName];
  if (typeof override === 'number') return override;
  const fallback = settings?.budgets?.defaults?.[categoryName];
  return typeof fallback === 'number' ? fallback : 0;
}

export function categoryByName(settings, name) {
  if (!name) return null;
  return settings.categories.find((c) => c.name === name) ?? null;
}

/** กลุ่มของประเภท ถ้าไม่รู้จักให้ใช้ค่าเริ่มต้นของ kind */
export function groupForCategory(settings, name, kind = 'expense') {
  return categoryByName(settings, name)?.group ?? defaultGroupFor(kind);
}

export function activeCategories(settings, { kind = null, group = null } = {}) {
  return settings.categories.filter((c) => {
    if (c.archived) return false;
    if (group && c.group !== group) return false;
    if (kind && groupKind(c.group) !== kind) return false;
    return true;
  });
}

/** สร้างรายการใหม่ให้ครบทุกฟิลด์ */
export function makeTransaction(input) {
  const now = Date.now();
  const kind = input.kind === 'income' ? 'income' : 'expense';
  return {
    id: input.id || newId(),
    kind,
    name: String(input.name ?? '').trim().slice(0, MAX_NAME),
    amount: normalizeAmount(input.amount),
    type: input.type ? String(input.type).slice(0, 100) : null,
    group: isGroupCode(input.group) ? input.group : defaultGroupFor(kind),
    date: input.date,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    deleted: input.deleted === true,
  };
}

export function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n >= MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // สำรองไว้เผื่อ context ที่ไม่มี crypto.randomUUID
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** ยอดรวมแยกตามกลุ่ม — รายจ่ายรวมการออมเงินตามแบบไฟล์เดิม */
export function summarize(transactions) {
  const byGroup = { IN: 0, DE: 0, SD: 0, IV: 0, SV: 0 };
  for (const tx of transactions) {
    if (tx.deleted) continue;
    byGroup[tx.group] = (byGroup[tx.group] ?? 0) + (tx.amount ?? 0);
  }
  const income = byGroup.IN;
  const savings = byGroup.SV;
  const expense = byGroup.DE + byGroup.SD + byGroup.IV + savings;
  return { byGroup, income, expense, savings, net: income - expense };
}

/** ยอดรวมแยกตามประเภท เรียงจากมากไปน้อย */
export function sumByType(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    if (tx.deleted) continue;
    const key = tx.type || 'ไม่ระบุประเภท';
    map.set(key, (map.get(key) ?? 0) + (tx.amount ?? 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
}
