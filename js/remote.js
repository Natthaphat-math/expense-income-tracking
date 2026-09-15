// การเชื่อมต่อ Firebase — โหลด SDK แบบ lazy จาก CDN
//
// สำคัญ: แอปนี้ต้องใช้งานได้แม้ไม่มีเน็ต ฉะนั้นห้าม import Firebase ไว้บนสุด
// ของไฟล์ไหนก็ตาม ทุกการโหลดต้องผ่าน loadFirebase() ซึ่งถ้าล้มเหลวก็แค่คืน null
// แล้วแอปทำงานต่อด้วย localStorage ตามปกติ

import { firebaseConfig, FIREBASE_SDK_VERSION } from './firebase-config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let sdkPromise = null;

/**
 * โหลด SDK และเตรียม app/auth/db ให้พร้อมใช้
 * @returns {Promise<object|null>} null เมื่อโหลดไม่ได้ (ออฟไลน์ / CDN ล่ม)
 */
export function loadFirebase() {
  if (!sdkPromise) {
    sdkPromise = importAll().catch((err) => {
      console.warn('โหลด Firebase ไม่สำเร็จ — ใช้งานแบบออฟไลน์ต่อไป', err);
      sdkPromise = null; // ให้ลองใหม่ได้เมื่อเน็ตกลับมา
      return null;
    });
  }
  return sdkPromise;
}

async function importAll() {
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);

  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  // เก็บสถานะเข้าสู่ระบบไว้ในเครื่อง เพื่อไม่ต้องล็อกอินใหม่ทุกครั้งที่เปิดแอป
  await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
  const db = storeMod.getFirestore(app);

  return { app, auth, db, authMod, storeMod };
}

/** true เมื่อเคยโหลด SDK สำเร็จแล้ว */
export function isLoaded() {
  return sdkPromise !== null;
}

// ---------------------------------------------------------------- เข้าสู่ระบบ

const EMAIL_KEY = 'tet:signin-email';

/** จำอีเมลที่ขอลิงก์ไว้ เพราะตอนกดลิงก์กลับมาต้องใช้ยืนยันคู่กัน */
export function rememberEmail(email) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch { /* โหมดส่วนตัวของ Safari */ }
}

export function recallEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function forgetEmail() {
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch { /* ไม่เป็นไร */ }
}

/**
 * ส่งลิงก์เข้าสู่ระบบไปที่อีเมล
 * ลิงก์จะชี้กลับมาที่หน้านี้ เพื่อให้กดแล้วเข้าสู่ระบบต่อได้เลย
 */
export async function sendSignInLink(email) {
  const fb = await loadFirebase();
  if (!fb) throw new Error('ต้องต่ออินเทอร์เน็ตก่อนจึงจะขอลิงก์ได้');

  const url = new URL(location.href);
  url.hash = '';
  url.search = '';

  await fb.authMod.sendSignInLinkToEmail(fb.auth, email, {
    url: url.toString(),
    handleCodeInApp: true,
  });
  rememberEmail(email);
}

/** true ถ้า URL ที่ให้มาเป็นลิงก์เข้าสู่ระบบของ Firebase */
export async function isSignInLink(link) {
  const fb = await loadFirebase();
  if (!fb) return false;
  try {
    return fb.authMod.isSignInWithEmailLink(fb.auth, link);
  } catch {
    return false;
  }
}

/**
 * เข้าสู่ระบบด้วยลิงก์จากอีเมล
 * @param {string} link URL เต็มของลิงก์ (จะกดจากอีเมล หรือคัดลอกมาวางก็ได้)
 * @param {string} email อีเมลที่ใช้ขอลิงก์
 */
export async function completeSignIn(link, email) {
  const fb = await loadFirebase();
  if (!fb) throw new Error('ต้องต่ออินเทอร์เน็ตก่อนจึงจะเข้าสู่ระบบได้');

  const address = (email || recallEmail()).trim();
  if (!address) throw new Error('ไม่พบอีเมลที่ใช้ขอลิงก์ กรุณากรอกอีเมลอีกครั้ง');

  const credential = await fb.authMod.signInWithEmailLink(fb.auth, address, link);
  forgetEmail();
  return credential.user;
}

export async function signOut() {
  const fb = await loadFirebase();
  if (!fb) return;
  await fb.authMod.signOut(fb.auth);
}

/** ผู้ใช้ปัจจุบัน หรือ null */
export async function currentUser() {
  const fb = await loadFirebase();
  if (!fb) return null;
  // รอให้ Firebase อ่านสถานะที่เก็บไว้ให้เสร็จก่อน ไม่งั้นจะได้ null ทั้งที่ล็อกอินอยู่
  if (fb.auth.currentUser) return fb.auth.currentUser;
  return new Promise((resolve) => {
    const stop = fb.authMod.onAuthStateChanged(fb.auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

/** ติดตามสถานะเข้าสู่ระบบ คืนฟังก์ชันสำหรับยกเลิกการติดตาม */
export async function watchAuth(callback) {
  const fb = await loadFirebase();
  if (!fb) {
    callback(null);
    return () => {};
  }
  return fb.authMod.onAuthStateChanged(fb.auth, callback);
}
