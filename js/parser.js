// แปลงข้อความอิสระเป็นรายการรายรับ/รายจ่าย
// โมดูลนี้บริสุทธิ์ (ไม่แตะ DOM) เพื่อให้ทดสอบด้วย Node ได้

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** แปลงเลขไทยเป็นเลขอารบิก */
export function thaiDigitsToArabic(text) {
  return String(text).replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

/**
 * ทำความสะอาดข้อความหนึ่งบรรทัด: ตัดช่องว่างหัวท้าย, ยุบช่องว่างซ้ำ,
 * แปลงเลขไทย, และตัดลูกน้ำคั่นหลักพันที่อยู่ในตัวเลข (1,234 -> 1234)
 */
export function normalizeLine(text) {
  let s = thaiDigitsToArabic(text ?? '');
  s = s.replace(/[ ​]/g, ' ');
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

// คำที่ตามหลังจำนวนเงินและไม่ใช่ชื่อประเภท
const CURRENCY_WORDS = ['บาทถ้วน', 'บาท', 'บ.', 'บ'];
// คำนำหน้าประเภทที่ผู้ใช้อาจพูด เช่น "ประเภทอาหาร"
const TYPE_PREFIXES = ['ประเภทคือ', 'ประเภท', 'หมวดหมู่', 'หมวด'];

function stripLeading(text, words) {
  for (const word of words) {
    if (text.startsWith(word)) {
      const rest = text.slice(word.length).trim();
      // "บาท" ต้องไม่กินคำอย่าง "บาทาเจ" — ยอมรับเมื่อขอบคำจบพอดี
      if (rest === '' || !/^[ก-๙a-zA-Z]/.test(rest) || word.length > 1) return rest;
    }
  }
  return text;
}

/**
 * ตัดคำว่า "บาท" ที่ตามหลังตัวเลขออก
 * พิมพ์ด้วยเสียงมักได้ "50 บาทค่าอาหาร" ติดกันไม่มีช่องว่าง — "บาท" หลังตัวเลขเป็นหน่วยเงินเสมอ
 * จึงตัดได้เลย ยกเว้น "บ" ตัวเดียว ซึ่งต้องจบคำพอดี (ไม่งั้น "50 บะหมี่" จะเสียคำ)
 */
function stripCurrency(text) {
  const rest = text.trim();
  for (const word of CURRENCY_WORDS) {
    if (!rest.startsWith(word)) continue;
    const after = rest.slice(word.length);
    if (word.length > 1 || after === '' || /^[^ก-๙a-zA-Z0-9]/.test(after)) return after.trim();
  }
  return rest;
}

// คำลงท้ายสุภาพจากการพูด เช่น "50 บาทค่ะ" — ไม่ใช่ชื่อประเภท
const POLITE_ENDING = /\s*(ค่ะ|คะ|ครับ|คับ|จ้ะ|จ้า)$/;

function stripTypePrefix(text) {
  return stripLeading(text.trim(), TYPE_PREFIXES).trim();
}

/**
 * หาประเภทที่ตรงกับคำหนึ่ง ๆ ตามลำดับ:
 * 1) ชื่อตรงเป๊ะ  2) "ค่า" + คำ (อาหาร -> ค่าอาหาร)  3) ชื่อที่มีคำนี้อยู่ข้างใน  4) นามแฝง
 * @returns {string|null} ชื่อประเภท
 */
export function matchCategory(word, categories, kind = null) {
  const term = String(word ?? '').trim();
  if (!term) return null;

  const pool = categories.filter((c) => {
    if (c.archived) return false;
    if (!kind) return true;
    return (c.group === 'IN' ? 'income' : 'expense') === kind;
  });
  const lower = term.toLowerCase();

  const exact = pool.find((c) => c.name === term || c.name.toLowerCase() === lower);
  if (exact) return exact.name;

  const prefixed = pool.find((c) => c.name === `ค่า${term}`);
  if (prefixed) return prefixed.name;

  const alias = pool.find((c) => (c.aliases || []).some((a) => a === term || a.toLowerCase() === lower));
  if (alias) return alias.name;

  const contains = pool.find((c) => c.name.includes(term) || term.includes(c.name));
  if (contains) return contains.name;

  return null;
}

/**
 * ลองจับคู่ประเภทจากส่วนท้ายของข้อความ โดยไล่จากวลียาวไปสั้น
 * @returns {{ name: string, matched: string, rest: string } | null}
 */
function matchTrailingCategory(text, categories, kind) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(' ');
  // ลองวลีท้าย 1–3 คำ โดยเริ่มจากยาวที่สุด
  for (let take = Math.min(3, words.length); take >= 1; take -= 1) {
    const phrase = words.slice(words.length - take).join(' ');
    const bare = stripTypePrefix(phrase);
    const found = matchCategory(bare, categories, kind);
    if (found) {
      return {
        name: found,
        matched: phrase,
        rest: words.slice(0, words.length - take).join(' ').trim(),
      };
    }
  }
  return null;
}

/**
 * แปลงข้อความหนึ่งบรรทัดเป็นร่างรายการ
 *
 * @param {string} line
 * @param {object} options
 * @param {Array} options.categories รายการประเภททั้งหมด
 * @param {'income'|'expense'} options.kind
 * @param {Map<string,string>|object} options.learned ชื่อรายการ -> ประเภทที่เคยใช้ล่าสุด
 * @returns {{name, amount, type, group, suggestedType, unknownType, raw}}
 */
export function parseLine(line, { categories = [], kind = 'expense', learned = null } = {}) {
  const raw = String(line ?? '');
  let text = normalizeLine(raw);
  const result = {
    raw,
    name: '',
    amount: null,
    type: null,
    suggestedType: null,
    unknownType: null,
  };
  if (!text) return result;
  text = text.replace(POLITE_ENDING, '').trim();
  if (!text) return result;

  // 1) จำนวนเงิน: ตัวเลขตัวแรก แม้จะติดกับตัวอักษร (เสียงพูดมักได้ "ก๋วยเตี๋ยว20บาท")
  const match = text.match(/\d+(?:\.\d+)?/);
  let before = text;
  let after = '';
  if (match) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) result.amount = value;
    before = text.slice(0, match.index).trim();
    after = text.slice(match.index + match[0].length);
  }

  // 2) ตัดหน่วยเงินที่ตามหลังตัวเลข แล้วที่เหลือคือประเภท (ถ้ามี)
  let tail = stripCurrency(after);
  tail = stripTypePrefix(tail);

  if (tail) {
    const found = matchCategory(tail, categories, kind);
    if (found) {
      result.type = found;
    } else {
      // ลองตัดเป็นวลีท้าย เผื่อมีคำอื่นปนมา
      const trailing = matchTrailingCategory(tail, categories, kind);
      if (trailing && trailing.rest === '') {
        result.type = trailing.name;
      } else {
        // ไม่รู้จัก — ไม่เอาไปต่อท้ายชื่อ แต่เสนอให้เพิ่มเป็นประเภทใหม่
        result.unknownType = tail;
      }
    }
  }

  result.name = before;

  // 3) ไม่มีตัวเลขเลย: ทั้งบรรทัดเป็นชื่อ แต่ยังลองจับประเภทจากคำท้าย
  if (!match) {
    const trailing = matchTrailingCategory(text, categories, kind);
    if (trailing && trailing.rest !== '') {
      result.type = trailing.name;
      result.name = trailing.rest;
    } else {
      result.name = text;
    }
  }

  result.name = result.name.trim();

  // 4) ถ้ายังไม่มีประเภท ลองใช้ประเภทที่เคยใช้กับชื่อเดียวกัน
  if (!result.type && result.name) {
    const remembered = lookupLearned(learned, result.name);
    if (remembered) result.suggestedType = remembered;
  }

  return result;
}

function lookupLearned(learned, name) {
  if (!learned) return null;
  const key = name.trim().toLowerCase();
  if (learned instanceof Map) return learned.get(key) ?? null;
  return learned[key] ?? null;
}

/**
 * เสนอประเภทให้ชื่อรายการที่ยังไม่ระบุประเภท (ใช้ในหน้าจัดประเภท)
 *
 * source = 'history' — เคยตั้งประเภทให้ชื่อนี้มาก่อน มั่นใจพอให้ "ใช้ทั้งหมด" ได้
 * source = 'guess'   — ชื่อขึ้นต้นด้วยชื่อประเภทหรือคำเรียกอื่นของประเภท
 *
 * เทียบเฉพาะคำขึ้นต้น ไม่หาคำที่อยู่กลางชื่อ เพราะจะเดาผิดง่าย
 * เช่น "รถไฟฟ้า" มีคำว่า "ไฟฟ้า" อยู่ แต่ไม่ใช่ค่าไฟฟ้า
 *
 * @returns {{ type: string, source: 'history'|'guess' } | null}
 */
export function suggestType(name, { categories = [], kind = 'expense', learned = null } = {}) {
  const text = String(name ?? '').trim();
  if (!text) return null;
  const pool = categories.filter((c) => !c.archived && (c.group === 'IN' ? 'income' : 'expense') === kind);
  const usable = (type) => pool.some((c) => c.name === type);

  const remembered = lookupLearned(learned, text);
  if (remembered && usable(remembered)) return { type: remembered, source: 'history' };

  const lower = text.toLowerCase();
  let best = null;
  for (const c of pool) {
    const words = [c.name, stripTypePrefix(c.name), ...(c.aliases || [])];
    for (const word of words) {
      const w = String(word ?? '').trim().toLowerCase();
      if (w.length < 2 || !lower.startsWith(w)) continue;
      // คำที่ยาวกว่าเจาะจงกว่า ("น้ำหวาน" ดีกว่า "น้ำ")
      if (!best || w.length > best.length) best = { length: w.length, type: c.name };
    }
  }
  return best ? { type: best.type, source: 'guess' } : null;
}

/** แยกข้อความหลายบรรทัด (ตัดบรรทัดว่างทิ้ง) */
export function splitLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** true เมื่อข้อความมีมากกว่าหนึ่งบรรทัดที่ไม่ว่าง — ใช้สลับไปโหมดหลายรายการ */
export function isBatch(text) {
  return splitLines(text).length > 1;
}

/** แปลงทุกบรรทัด */
export function parseText(text, options) {
  return splitLines(text).map((line) => parseLine(line, options));
}

/**
 * สร้างตาราง "ชื่อรายการ -> ประเภทที่ใช้ล่าสุด" จากประวัติ (รวมข้อมูลที่นำเข้ามา)
 * @returns {Map<string,string>}
 */
export function buildLearnedTypes(transactions) {
  const latest = new Map();
  for (const tx of transactions) {
    if (tx.deleted || !tx.type || !tx.name) continue;
    const key = tx.name.trim().toLowerCase();
    const previous = latest.get(key);
    const stamp = tx.updatedAt ?? tx.createdAt ?? 0;
    if (!previous || stamp >= previous.stamp) latest.set(key, { type: tx.type, stamp });
  }
  return new Map([...latest].map(([name, v]) => [name, v.type]));
}
