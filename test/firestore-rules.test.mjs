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
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

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
