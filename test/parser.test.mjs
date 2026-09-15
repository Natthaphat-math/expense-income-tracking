// ทดสอบตัวแปลงข้อความ — รันด้วย: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLine,
  parseText,
  normalizeLine,
  thaiDigitsToArabic,
  matchCategory,
  isBatch,
  splitLines,
  buildLearnedTypes,
} from '../js/parser.js';

const categories = [
  { name: 'เงินเดือน', group: 'IN', aliases: [], archived: false },
  { name: 'รายได้เสริม', group: 'IN', aliases: ['งานเสริม'], archived: false },
  { name: 'ค่าอาหาร', group: 'DE', aliases: ['ข้าว'], archived: false },
  { name: 'ค่าเดินทาง', group: 'DE', aliases: ['รถเมล์'], archived: false },
  { name: 'ค่าของหวาน', group: 'DE', aliases: [], archived: false },
  { name: 'น้ำหวาน', group: 'DE', aliases: ['ชา'], archived: false },
  { name: 'ค่าไฟฟ้า', group: 'SD', aliases: ['ค่าไฟ'], archived: false },
  { name: 'ซื้อหนังสือ', group: 'IV', aliases: [], archived: false },
  { name: 'ออมสำหรับฉุกเฉิน', group: 'SV', aliases: ['ฉุกเฉิน'], archived: false },
];

const opts = { categories, kind: 'expense' };

function parse(line, extra = {}) {
  return parseLine(line, { ...opts, ...extra });
}

test('ตัวอย่างหลักจากโจทย์: ทุกแบบต้องได้ ก๋วยเตี๋ยว / 20 / ค่าอาหาร', () => {
  for (const line of [
    'ก๋วยเตี๋ยว 20 บาท ประเภทอาหาร',
    'ก๋วยเตี๋ยว 20 บาท อาหาร',
    'ก๋วยเตี๋ยว 20 อาหาร',
  ]) {
    const r = parse(line);
    assert.equal(r.name, 'ก๋วยเตี๋ยว', line);
    assert.equal(r.amount, 20, line);
    assert.equal(r.type, 'ค่าอาหาร', line);
  }
});

test('ชื่ออย่างเดียว — ผู้ใช้กรอกที่เหลือเอง', () => {
  const r = parse('ก๋วยเตี๋ยว');
  assert.equal(r.name, 'ก๋วยเตี๋ยว');
  assert.equal(r.amount, null);
  assert.equal(r.type, null);
  assert.equal(r.unknownType, null);
});

test('เสียงพูดที่ไม่มีช่องว่าง', () => {
  assert.deepEqual(
    (({ name, amount }) => ({ name, amount }))(parse('ก๋วยเตี๋ยว20บาท')),
    { name: 'ก๋วยเตี๋ยว', amount: 20 },
  );
  const r = parse('ค่ารถ40บ.');
  assert.equal(r.name, 'ค่ารถ');
  assert.equal(r.amount, 40);
});

test('เลขไทย', () => {
  assert.equal(thaiDigitsToArabic('๑๒๓'), '123');
  const r = parse('กาแฟ ๘๕ บาท');
  assert.equal(r.name, 'กาแฟ');
  assert.equal(r.amount, 85);
  const withType = parse('กาแฟ ๘๕ บาท ประเภทน้ำหวาน');
  assert.equal(withType.amount, 85);
  assert.equal(withType.type, 'น้ำหวาน');
});

test('ทศนิยมและลูกน้ำคั่นหลักพัน', () => {
  assert.equal(parse('ข้าวแกง 24.5').amount, 24.5);
  assert.equal(parse('ตั๋วเครื่องบิน 1,250.50 บาท').amount, 1250.5);
  assert.equal(parse('ทอง 32,000 บาท').amount, 32000);
  assert.equal(normalizeLine('ของ 1,234,567 บาท'), 'ของ 1234567 บาท');
});

test('ประเภทที่ไม่รู้จัก — ไม่ปนเข้าไปในชื่อ แต่เสนอให้เพิ่มใหม่', () => {
  const r = parse('ของ 30 บาท ซุปเปอร์มาร์เก็ต');
  assert.equal(r.name, 'ของ');
  assert.equal(r.amount, 30);
  assert.equal(r.type, null);
  assert.equal(r.unknownType, 'ซุปเปอร์มาร์เก็ต');
});

test('จับคู่ประเภท: ตรงเป๊ะ / เติม "ค่า" / นามแฝง / มีคำนั้นอยู่ข้างใน', () => {
  assert.equal(matchCategory('ค่าอาหาร', categories), 'ค่าอาหาร');
  assert.equal(matchCategory('อาหาร', categories), 'ค่าอาหาร');
  assert.equal(matchCategory('รถเมล์', categories), 'ค่าเดินทาง');
  assert.equal(matchCategory('ไฟฟ้า', categories), 'ค่าไฟฟ้า');
  assert.equal(matchCategory('ไม่มีอยู่จริง', categories), null);
});

test('จับคู่ประเภทแยกตามรายรับ/รายจ่าย', () => {
  assert.equal(matchCategory('เงินเดือน', categories, 'income'), 'เงินเดือน');
  assert.equal(matchCategory('เงินเดือน', categories, 'expense'), null);
  const r = parseLine('เงินเดือน 18000.5 เงินเดือน', { categories, kind: 'income' });
  assert.equal(r.amount, 18000.5);
  assert.equal(r.type, 'เงินเดือน');
});

test('ไม่มีตัวเลข แต่ลงท้ายด้วยชื่อประเภท', () => {
  const r = parse('ข้าวมันไก่ อาหาร');
  assert.equal(r.name, 'ข้าวมันไก่');
  assert.equal(r.type, 'ค่าอาหาร');
  assert.equal(r.amount, null);
});

test('ประเภทที่ตรงกับทั้งบรรทัด ไม่ควรทำให้ชื่อว่าง', () => {
  const r = parse('ค่าอาหาร');
  assert.equal(r.name, 'ค่าอาหาร');
  assert.equal(r.amount, null);
});

test('คำนำหน้า "หมวด" ก็ใช้ได้', () => {
  const r = parse('ชานม 45 หมวดน้ำหวาน');
  assert.equal(r.name, 'ชานม');
  assert.equal(r.type, 'น้ำหวาน');
});

test('ประเภทที่เคยใช้กับชื่อเดียวกันถูกเสนอให้', () => {
  const learned = buildLearnedTypes([
    { name: 'ก๋วยเตี๋ยว', type: 'ค่าอาหาร', updatedAt: 1, deleted: false },
    { name: 'ก๋วยเตี๋ยว', type: 'น้ำหวาน', updatedAt: 5, deleted: false },
    { name: 'ชานม', type: 'น้ำหวาน', updatedAt: 2, deleted: false },
  ]);
  assert.equal(learned.get('ก๋วยเตี๋ยว'), 'น้ำหวาน', 'ใช้ครั้งล่าสุดชนะ');
  const r = parse('ก๋วยเตี๋ยว 20', { learned });
  assert.equal(r.type, null);
  assert.equal(r.suggestedType, 'น้ำหวาน');
});

test('ประเภทที่ระบุมาเองชนะข้อเสนอจากประวัติ', () => {
  const learned = new Map([['ก๋วยเตี๋ยว', 'น้ำหวาน']]);
  const r = parse('ก๋วยเตี๋ยว 20 อาหาร', { learned });
  assert.equal(r.type, 'ค่าอาหาร');
  assert.equal(r.suggestedType, null);
});

test('หลายบรรทัดตามตัวอย่างในโจทย์', () => {
  const text = 'ก๋วยเตี๋ยว 20 บาท อาหาร\nชานม 45 น้ำหวาน\nรถเมล์ 25 เดินทาง';
  assert.equal(isBatch(text), true);
  const rows = parseText(text, opts);
  assert.deepEqual(
    rows.map((r) => [r.name, r.amount, r.type]),
    [
      ['ก๋วยเตี๋ยว', 20, 'ค่าอาหาร'],
      ['ชานม', 45, 'น้ำหวาน'],
      ['รถเมล์', 25, 'ค่าเดินทาง'],
    ],
  );
});

test('บรรทัดว่างถูกตัดทิ้ง และบรรทัดเดียวไม่นับเป็นหลายรายการ', () => {
  assert.deepEqual(splitLines('  ก๋วยเตี๋ยว \n\n   \nชานม 45\n'), ['ก๋วยเตี๋ยว', 'ชานม 45']);
  assert.equal(isBatch('ก๋วยเตี๋ยว 20\n\n'), false);
  assert.equal(isBatch(''), false);
});

test('ข้อความว่างไม่ทำให้พัง', () => {
  const r = parse('   ');
  assert.equal(r.name, '');
  assert.equal(r.amount, null);
  assert.equal(r.type, null);
});

test('ประเภทที่เก็บถาวรแล้วไม่ถูกจับคู่', () => {
  const archived = [{ name: 'ค่าอาหาร', group: 'DE', aliases: [], archived: true }];
  assert.equal(matchCategory('อาหาร', archived), null);
});

test('ตัวเลขตัวแรกเท่านั้นที่เป็นมูลค่า', () => {
  const r = parse('ข้าว 2 กล่อง 80 บาท');
  assert.equal(r.amount, 2);
  assert.equal(r.name, 'ข้าว');
});
