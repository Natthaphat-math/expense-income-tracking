// การจัดรูปแบบตัวเลข วันที่ และข้อความภาษาไทย
// หมายเหตุ: 'th-TH' เฉย ๆ จะใช้ปฏิทินพุทธ (2569) — ต้องใส่ -u-ca-gregory เพื่อให้ได้ ค.ศ.

const MONEY_FMT = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const MONTH_LONG = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { month: 'long' });
const MONTH_SHORT = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { weekday: 'long' });

/** 1234.5 -> "1,234.5" */
export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return MONEY_FMT.format(value);
}

/** 1234.5 -> "1,234.5 บาท" */
export function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'ยังไม่ระบุมูลค่า';
  return `${MONEY_FMT.format(value)} บาท`;
}

/** ใส่เครื่องหมาย +/- นำหน้าเสมอ สำหรับยอดคงเหลือ */
export function formatSigned(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '−' : '';
  return `${sign}${MONEY_FMT.format(Math.abs(value))} บาท`;
}

/** วันที่วันนี้เป็น 'YYYY-MM-DD' ตามเวลาเครื่อง — ห้ามใช้ toISOString() (ไทย UTC+7 จะได้เมื่อวาน) */
export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> Date ตามเวลาเครื่อง (ไม่ผ่าน UTC) */
export function fromISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const date = fromISODate(iso);
  return toISODate(date) === iso;
}

/** เลื่อนวันแบบปลอดภัย */
export function addDays(iso, days) {
  const date = fromISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** 'YYYY-MM-DD' -> 'YYYY-MM' */
export function monthKeyOf(iso) {
  return String(iso).slice(0, 7);
}

export function monthKey(year, month /* 1-12 */) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parseMonthKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  return { year: y, month: m };
}

/** เดือนก่อนหน้าของ 'YYYY-MM' */
export function previousMonthKey(key) {
  const { year, month } = parseMonthKey(key);
  return month === 1 ? monthKey(year - 1, 12) : monthKey(year, month - 1);
}

export function shiftMonthKey(key, delta) {
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** ชื่อเดือนภาษาไทยแบบเต็ม เช่น "มกราคม" */
export function monthName(month /* 1-12 */) {
  return MONTH_LONG.format(new Date(2020, month - 1, 1));
}

export function monthNameShort(month) {
  return MONTH_SHORT.format(new Date(2020, month - 1, 1));
}

/** "มกราคม 2026" — ปี ค.ศ. ตามที่ตกลงกันไว้ */
export function monthTitle(key) {
  const { year, month } = parseMonthKey(key);
  return `${monthName(month)} ${year}`;
}

/** "วันจันทร์ที่ 15 กันยายน 2026" */
export function longDate(iso) {
  const date = fromISODate(iso);
  return `${WEEKDAY.format(date)}ที่ ${date.getDate()} ${monthName(date.getMonth() + 1)} ${date.getFullYear()}`;
}

/** "15 ก.ย. 2026" */
export function shortDate(iso) {
  const date = fromISODate(iso);
  return `${date.getDate()} ${monthNameShort(date.getMonth() + 1)} ${date.getFullYear()}`;
}

/** "วันนี้" / "เมื่อวาน" / วันที่ย่อ */
export function relativeDate(iso, today = todayISO()) {
  if (iso === today) return 'วันนี้';
  if (iso === addDays(today, -1)) return 'เมื่อวาน';
  if (iso === addDays(today, 1)) return 'พรุ่งนี้';
  return shortDate(iso);
}

export function daysInMonth(key) {
  const { year, month } = parseMonthKey(key);
  return new Date(year, month, 0).getDate();
}
