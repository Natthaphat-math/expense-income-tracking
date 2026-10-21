// ทดสอบกฎความปลอดภัยของ Firestore จริง ๆ ด้วย emulator
//
// วิธีรัน (ต้องมี Java และเน็ตครั้งแรกเพื่อโหลด emulator):
//   npx firebase-tools emulators:exec --only firestore --project demo-test \
//     "node --test test/firestore-rules.test.mjs"
//
// ทดสอบนี้ยิงใส่ emulator ในเครื่อง ไม่แตะข้อมูลจริงบนคลาวด์

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWNER = 'owner@example.com';
const STRANGER = 'someone-else@example.com';
const OWNER_UID = 'owner-uid';

let env;

before(async () => {
  // กฎในไฟล์ยังเป็น placeholder — ใส่อีเมลทดสอบแทนตอนโหลด
  const rules = fs
    .readFileSync(path.join(HERE, '..', 'docs', 'firestore.rules'), 'utf8')
    .replaceAll('OWNER_EMAIL_HERE', OWNER);

  env = await initializeTestEnvironment({
    projectId: 'demo-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

after(async () => { if (env) await env.cleanup(); });

/** ผู้ใช้ที่เป็นเจ้าของจริง: uid ตรง อีเมลตรง และยืนยันอีเมลแล้ว */
const ownerDb = () => env.authenticatedContext(OWNER_UID, {
  email: OWNER, email_verified: true,
}).firestore();

const validTx = (over = {}) => ({
  id: 'tx1', kind: 'expense', name: 'ก๋วยเตี๋ยว', amount: 20, type: 'ค่าอาหาร',
  group: 'DE', date: '2026-01-15', createdAt: 1767225600000, updatedAt: 1767225600000,
  deleted: false, ...over,
});

const txRef = (db, uid = OWNER_UID, id = 'tx1') =>
  doc(db, 'users', uid, 'transactions', id);

// ───────────────────────────────────────────────── ใครเข้าถึงได้บ้าง

test('คนที่ไม่ได้เข้าสู่ระบบ อ่านไม่ได้ เขียนไม่ได้', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(txRef(db)));
  await assertFails(setDoc(txRef(db), validTx()));
  await assertFails(getDocs(collection(db, 'users', OWNER_UID, 'transactions')));
});

test('อีเมลอื่น เข้าถึงข้อมูลของเจ้าของไม่ได้', async () => {
  const db = env.authenticatedContext('other-uid', {
    email: STRANGER, email_verified: true,
  }).firestore();
  await assertFails(getDoc(txRef(db)));
  await assertFails(setDoc(txRef(db), validTx()));
});

test('อีเมลถูกแต่ยังไม่ได้ยืนยัน เข้าไม่ได้', async () => {
  const db = env.authenticatedContext(OWNER_UID, {
    email: OWNER, email_verified: false,
  }).firestore();
  await assertFails(getDoc(txRef(db)));
  await assertFails(setDoc(txRef(db), validTx()));
});

test('อีเมลถูกแต่ uid ไม่ตรงกับเจ้าของพื้นที่ เข้าไม่ได้', async () => {
  const db = env.authenticatedContext('different-uid', {
    email: OWNER, email_verified: true,
  }).firestore();
  await assertFails(getDoc(txRef(db, OWNER_UID)));
  await assertFails(setDoc(txRef(db, OWNER_UID), validTx()));
});

test('เจ้าของ อ่านและเขียนข้อมูลตัวเองได้', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(txRef(db), validTx()));
  await assertSucceeds(getDoc(txRef(db)));
  await assertSucceeds(getDocs(collection(db, 'users', OWNER_UID, 'transactions')));
  await assertSucceeds(deleteDoc(txRef(db)));
});

// ───────────────────────────────────────────── ตรวจค่าที่เขียนลงไป

test('id ในเอกสารต้องตรงกับชื่อเอกสาร', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db, OWNER_UID, 'tx1'), validTx({ id: 'ไม่ตรง' })));
});

test('มูลค่าติดลบหรือเกินช่วง เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ amount: -5 })));
  await assertFails(setDoc(txRef(db), validTx({ amount: 100000000 })));
  await assertSucceeds(setDoc(txRef(db), validTx({ amount: 0 })));
  await assertSucceeds(setDoc(txRef(db), validTx({ amount: null })));
});

test('ฟิลด์ของสลิป: รูปแบบถูกต้องเท่านั้น', async () => {
  const db = ownerDb();
  const hash = 'a'.repeat(64);
  await assertSucceeds(setDoc(txRef(db), validTx({ slipRef: '004:012345678901ABC00001', slipHash: hash })));
  await assertSucceeds(setDoc(txRef(db), validTx({ slipRef: null, slipHash: null })));
  await assertSucceeds(setDoc(txRef(db), validTx({ slipHash: hash })));
  await assertFails(setDoc(txRef(db), validTx({ slipRef: 'KBANK:123456' })));
  await assertFails(setDoc(txRef(db), validTx({ slipRef: '004:' + 'x'.repeat(41) })));
  await assertFails(setDoc(txRef(db), validTx({ slipRef: '004:<script>' })));
  await assertFails(setDoc(txRef(db), validTx({ slipHash: 'A'.repeat(64) })));
  await assertFails(setDoc(txRef(db), validTx({ slipHash: 123 })));
  await assertFails(setDoc(txRef(db), validTx({ slipImage: 'data:image/png;base64,...' })));
});

test('splitRef: id รูปแบบเดียวกับรายการหารกันเท่านั้น', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(txRef(db), validTx({ splitRef: 'm1abc-DEF_9' })));
  await assertFails(setDoc(txRef(db), validTx({ splitRef: '<x>' })));
  await assertFails(setDoc(txRef(db), validTx({ splitRef: 'a'.repeat(65) })));
  await assertFails(setDoc(txRef(db), validTx({ splitRef: 5 })));
});

test('syncedAt ต้องเป็นเวลาของเซิร์ฟเวอร์เท่านั้น', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(txRef(db), validTx({ syncedAt: serverTimestamp() })));
  await assertFails(setDoc(txRef(db), validTx({ syncedAt: Timestamp.fromMillis(Date.now()) })));
  await assertFails(setDoc(txRef(db), validTx({ syncedAt: 123 })));
  await assertSucceeds(getDocs(query(collection(db, 'users', OWNER_UID, 'transactions'), where('syncedAt', '>', Timestamp.fromMillis(0)))));
});

test('กลุ่มรายการที่ไม่รู้จัก เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ group: 'XX' })));
  for (const group of ['IN', 'DE', 'SD', 'IV', 'SV']) {
    await assertSucceeds(setDoc(txRef(db), validTx({ group })));
  }
});

test('ชนิดรายการต้องเป็น income หรือ expense เท่านั้น', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ kind: 'transfer' })));
});

test('ชื่อว่างหรือยาวเกิน 200 ตัว เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ name: '' })));
  await assertFails(setDoc(txRef(db), validTx({ name: 'ก'.repeat(201) })));
  await assertSucceeds(setDoc(txRef(db), validTx({ name: 'ก'.repeat(200) })));
});

test('รูปแบบวันที่ผิด เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ date: '15/01/2026' })));
  await assertFails(setDoc(txRef(db), validTx({ date: '2026-1-5' })));
  await assertSucceeds(setDoc(txRef(db), validTx({ date: '2026-01-05' })));
});

test('ฟิลด์แปลกปลอมที่ไม่ได้อยู่ในรายการ เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ evil: 'payload' })));
});

test('ฟิลด์ที่จำเป็นหายไป เขียนไม่ได้', async () => {
  const db = ownerDb();
  const { name, ...missingName } = validTx();
  await assertFails(setDoc(txRef(db), missingName));
  const { group, ...missingGroup } = validTx();
  await assertFails(setDoc(txRef(db), missingGroup));
});

test('ชนิดข้อมูลผิด เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(txRef(db), validTx({ deleted: 'yes' })));
  await assertFails(setDoc(txRef(db), validTx({ createdAt: 'เมื่อวาน' })));
  await assertFails(setDoc(txRef(db), validTx({ amount: '20' })));
});

// ───────────────────────────────────────────────── เอกสารตั้งค่า

test('เจ้าของเขียนเอกสารตั้งค่าที่ถูกต้องได้', async () => {
  const db = ownerDb();
  await assertSucceeds(setDoc(doc(db, 'users', OWNER_UID, 'meta', 'settings'), {
    categories: [{ name: 'ค่าอาหาร', group: 'DE', aliases: ['ข้าว'], archived: false }],
    budgets: { defaults: { 'ค่าอาหาร': 5000 }, months: {} },
    openingBalances: { '2026-01': 0 },
    carryOverBalance: true,
    lastBackupAt: null,
    updatedAt: 1767225600000,
  }));
});

test('เอกสารตั้งค่าที่มีฟิลด์แปลกปลอม เขียนไม่ได้', async () => {
  const db = ownerDb();
  await assertFails(setDoc(doc(db, 'users', OWNER_UID, 'meta', 'settings'), {
    categories: [], budgets: { defaults: {}, months: {} }, openingBalances: {},
    evil: true,
  }));
});

test('คนอื่นแตะเอกสารตั้งค่าไม่ได้', async () => {
  const db = env.authenticatedContext('other-uid', {
    email: STRANGER, email_verified: true,
  }).firestore();
  await assertFails(getDoc(doc(db, 'users', OWNER_UID, 'meta', 'settings')));
  await assertFails(setDoc(doc(db, 'users', OWNER_UID, 'meta', 'settings'), { categories: [] }));
});

// ───────────────────────────────────────────── ที่อื่นต้องปิดหมด

test('เส้นทางอื่นนอก users/ ปิดทั้งหมด แม้เป็นเจ้าของ', async () => {
  const db = ownerDb();
  await assertFails(getDoc(doc(db, 'anything', 'doc1')));
  await assertFails(setDoc(doc(db, 'anything', 'doc1'), { x: 1 }));
  await assertFails(setDoc(doc(db, 'users', OWNER_UID, 'meta', 'other'), { x: 1 }));
});

// ───────────────────────────────────────────────── หารกัน (สองคน)

const PARTNER = 'partner@example.com';
const PARTNER_UID = 'partner-uid';
const PAIR = 'main';

const partnerDb = () => env.authenticatedContext(PARTNER_UID, {
  email: PARTNER, email_verified: true,
}).firestore();

async function seedPair() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pairs', PAIR), {
      members: [OWNER, PARTNER], names: ['เธอ', 'เขา'], owner: OWNER,
    });
  });
}

const split = (by, over = {}) => ({
  id: 's1', kind: 'item', debtor: OWNER, creditor: PARTNER, amount: 50, total: null,
  name: 'ข้าวผัด', date: '2026-10-20', settled: false, settledBy: null, settledAt: null,
  createdBy: by, createdAt: 1792000000000, updatedAt: 1792000000000, updatedBy: by,
  deleted: false, ...over,
});
const splitRef = (db, id = 's1') => doc(db, 'pairs', PAIR, 'splits', id);

test('หารกัน: สมาชิกทั้งสองคนอ่านและเพิ่มรายการได้', async () => {
  await seedPair();
  await assertSucceeds(getDoc(doc(partnerDb(), 'pairs', PAIR)));
  await assertSucceeds(setDoc(splitRef(partnerDb()), split(PARTNER)));
  await assertSucceeds(getDoc(splitRef(ownerDb())));
  await assertSucceeds(getDocs(collection(ownerDb(), 'pairs', PAIR, 'splits')));
});

test('หารกัน: คนนอก อีเมลที่ยังไม่ยืนยัน และคนที่ไม่ได้เข้าสู่ระบบ เข้าไม่ได้', async () => {
  await seedPair();
  const stranger = env.authenticatedContext('x', { email: STRANGER, email_verified: true }).firestore();
  const unverified = env.authenticatedContext(PARTNER_UID, { email: PARTNER, email_verified: false }).firestore();
  for (const db of [stranger, unverified, env.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'pairs', PAIR)));
    await assertFails(getDoc(splitRef(db)));
    await assertFails(setDoc(splitRef(db, 's9'), split(PARTNER, { id: 's9' })));
  }
});

test('หารกัน: สมาชิกแก้เอกสาร pairs เองไม่ได้ (เพิ่มคนเข้าคู่ไม่ได้)', async () => {
  await seedPair();
  await assertFails(setDoc(doc(ownerDb(), 'pairs', PAIR), { members: [OWNER, PARTNER, STRANGER], names: [], owner: OWNER }));
});

test('หารกัน: ปลอมเป็นอีกฝ่ายไม่ได้', async () => {
  await seedPair();
  await assertFails(setDoc(splitRef(partnerDb(), 's2'), split(OWNER, { id: 's2', updatedBy: OWNER })));
  await assertFails(setDoc(splitRef(partnerDb(), 's2'), split(OWNER, { id: 's2', updatedBy: PARTNER })));
});

test('หารกัน: ข้อมูลผิดรูปแบบถูกปฏิเสธ', async () => {
  await seedPair();
  const db = partnerDb();
  const bad = [
    { debtor: STRANGER },                    // คนนอกคู่
    { debtor: PARTNER },                     // ค้างตัวเอง
    { amount: 0 }, { amount: -5 }, { amount: '50' }, { amount: 100000000 },
    { total: 10 },                           // ยอดรวมน้อยกว่าส่วนที่ค้าง
    { name: '' },                            // รายการต้องมีชื่อ
    { name: 'x'.repeat(201) },
    { kind: 'loan' },
    { date: '20/10/2026' },
    { settledBy: STRANGER },
    { extra: 'ไม่อนุญาต' },
  ];
  for (const over of bad) {
    await assertFails(setDoc(splitRef(db, 'bad'), split(PARTNER, { id: 'bad', ...over })), JSON.stringify(over));
  }
  await assertFails(setDoc(splitRef(db, 'other'), split(PARTNER, { id: 'notmatching' })));
  // การโอนคืนไม่ต้องมีชื่อ
  await assertSucceeds(setDoc(splitRef(db, 'p1'), split(PARTNER, { id: 'p1', kind: 'payment', debtor: PARTNER, creditor: OWNER, name: '' })));
});

test('หารกัน: อีกฝ่ายติ๊กเคลียร์และแก้ได้ แต่เปลี่ยนคนสร้าง/ชนิด/เวลาสร้างไม่ได้ และลบจริงไม่ได้', async () => {
  await seedPair();
  await assertSucceeds(setDoc(splitRef(partnerDb(), 's3'), split(PARTNER, { id: 's3' })));
  const owner = ownerDb();
  await assertSucceeds(setDoc(splitRef(owner, 's3'), split(PARTNER, {
    id: 's3', settled: true, settledBy: OWNER, settledAt: 1792000100000, updatedBy: OWNER, updatedAt: 1792000100000,
  })));
  await assertFails(setDoc(splitRef(owner, 's3'), split(OWNER, { id: 's3', updatedBy: OWNER })));
  await assertFails(setDoc(splitRef(owner, 's3'), split(PARTNER, { id: 's3', kind: 'payment', updatedBy: OWNER })));
  await assertFails(setDoc(splitRef(owner, 's3'), split(PARTNER, { id: 's3', createdAt: 1, updatedBy: OWNER })));
  await assertSucceeds(setDoc(splitRef(owner, 's3'), split(PARTNER, { id: 's3', deleted: true, updatedBy: OWNER })));
  await assertFails(deleteDoc(splitRef(owner, 's3')));
});

test('หารกัน: อีกฝ่ายยังเข้าข้อมูลส่วนตัวของเจ้าของไม่ได้', async () => {
  await seedPair();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(txRef(ctx.firestore()), validTx());
  });
  const db = partnerDb();
  await assertFails(getDoc(txRef(db)));
  await assertFails(getDocs(collection(db, 'users', OWNER_UID, 'transactions')));
  await assertFails(setDoc(txRef(db, PARTNER_UID, 'mine'), validTx({ id: 'mine' })));
  await assertFails(getDoc(doc(db, 'users', OWNER_UID, 'meta', 'settings')));
});

test('ชื่อเล่น: ตั้งได้เฉพาะของตัวเอง อีกฝ่ายอ่านได้ คนนอกเข้าไม่ได้', async () => {
  await seedPair();
  const nick = (db, setter) => doc(db, 'pairs', PAIR, 'nicknames', setter);
  const ok = { name: 'ที่รัก', updatedAt: 1792000000000 };
  await assertSucceeds(setDoc(nick(ownerDb(), OWNER), ok));
  await assertSucceeds(getDoc(nick(partnerDb(), OWNER)));
  await assertFails(setDoc(nick(partnerDb(), OWNER), ok));        // ตั้งแทนอีกฝ่ายไม่ได้
  await assertSucceeds(setDoc(nick(partnerDb(), PARTNER), { name: 'หมีพูห์', updatedAt: 1792000000001 }));
  await assertFails(setDoc(nick(ownerDb(), OWNER), { name: '', updatedAt: 1 }));
  await assertFails(setDoc(nick(ownerDb(), OWNER), { name: 'x'.repeat(31), updatedAt: 1 }));
  await assertFails(setDoc(nick(ownerDb(), OWNER), { name: 'ok', updatedAt: 1, extra: true }));
  await assertFails(setDoc(nick(ownerDb(), OWNER), { name: 5, updatedAt: 1 }));
  const stranger = env.authenticatedContext('x', { email: STRANGER, email_verified: true }).firestore();
  await assertFails(getDoc(nick(stranger, OWNER)));
  await assertFails(setDoc(nick(stranger, STRANGER), ok));
  await assertSucceeds(deleteDoc(nick(ownerDb(), OWNER)));
  await assertFails(deleteDoc(nick(ownerDb(), PARTNER)));
});

test('หารกัน: settledAs รับเฉพาะ paid / forgiven', async () => {
  await seedPair();
  const db = partnerDb();
  await assertSucceeds(setDoc(splitRef(db, 'f1'), split(PARTNER, { id: 'f1', settled: true, settledBy: PARTNER, settledAt: 1792000000000, settledAs: 'forgiven' })));
  await assertSucceeds(setDoc(splitRef(db, 'f2'), split(PARTNER, { id: 'f2', settled: true, settledBy: PARTNER, settledAt: 1792000000000, settledAs: 'paid' })));
  await assertSucceeds(setDoc(splitRef(db, 'f3'), split(PARTNER, { id: 'f3', settledAs: null })));
  await assertFails(setDoc(splitRef(db, 'f4'), split(PARTNER, { id: 'f4', settled: true, settledAs: 'gift' })));
  await assertFails(setDoc(splitRef(db, 'f5'), split(PARTNER, { id: 'f5', settled: true, settledAs: 1 })));
});

test('หารกัน: bucket รับเฉพาะ general / home', async () => {
  await seedPair();
  const db = partnerDb();
  await assertSucceeds(setDoc(splitRef(db, 'b1'), split(PARTNER, { id: 'b1', bucket: 'home' })));
  await assertSucceeds(setDoc(splitRef(db, 'b2'), split(PARTNER, { id: 'b2', bucket: 'general' })));
  await assertFails(setDoc(splitRef(db, 'b3'), split(PARTNER, { id: 'b3', bucket: 'party' })));
});

test('ทางลัด: สมาชิกสองคนเพิ่ม แก้ ลบได้ รูปแบบต้องถูก คนนอกเข้าไม่ได้', async () => {
  await seedPair();
  const ref = (db, id = 'sc1') => doc(db, 'pairs', PAIR, 'shortcuts', id);
  const sc = (by, over = {}) => ({ id: 'sc1', name: 'ค่าเน็ต', payer: PARTNER, mode: 'half', amount: null, bucket: 'home', order: 0, updatedAt: 1792000000000, updatedBy: by, ...over });
  await assertSucceeds(setDoc(ref(partnerDb()), sc(PARTNER)));
  await assertSucceeds(getDoc(ref(ownerDb())));
  await assertSucceeds(setDoc(ref(ownerDb()), sc(OWNER, { name: 'ค่าอินเทอร์เน็ต', amount: 321 })));
  for (const over of [{ payer: STRANGER }, { mode: 'third' }, { bucket: 'x' }, { name: '' }, { name: 'x'.repeat(61) }, { amount: -1 }, { order: 1000 }, { extra: 1 }, { id: 'other' }]) {
    await assertFails(setDoc(ref(partnerDb()), sc(PARTNER, over)), JSON.stringify(over));
  }
  await assertFails(setDoc(ref(partnerDb()), sc(OWNER)));             // ปลอมคนแก้
  const stranger = env.authenticatedContext('x', { email: STRANGER, email_verified: true }).firestore();
  await assertFails(getDoc(ref(stranger)));
  await assertFails(setDoc(ref(stranger, 'sc9'), sc(STRANGER, { id: 'sc9' })));
  await assertSucceeds(deleteDoc(ref(ownerDb())));
});
