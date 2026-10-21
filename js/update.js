// อัปเดตแอปเอง — ไม่ต้องปิดแอปให้หมดแล้วเปิดใหม่
//
// แอปบนหน้าจอโฮมของ iPhone ค้างอยู่ในหน่วยความจำได้หลายวัน จึงไม่เคยโหลดโค้ดใหม่
// ทางแก้: ตรวจหาเวอร์ชันใหม่เมื่อกลับมาที่แอป แล้วสลับไปใช้เวอร์ชันใหม่ "ตอนที่ปลอดภัย" เท่านั้น
//   - ทันทีที่กลับมาที่แอปและยังไม่ได้แตะอะไร
//   - หรือไม่ได้ใช้งาน 30 วินาที และไม่มีฟอร์ม/แผ่นที่เปิดค้าง ไม่มีช่องที่กำลังพิมพ์ ไม่มีรายการที่เลือกไว้
// ข้อมูลไม่หาย: รายการส่วนตัวบันทึกในเครื่องทันที หารกันบันทึกลงแคชของ Firestore ทันที

import { toast } from './ui.js';

const CHECK_EVERY = 10 * 60 * 1000;   // ตรวจหาเวอร์ชันใหม่ไม่ถี่กว่านี้
const IDLE_MS = 30 * 1000;
const FRESH_MS = 5 * 1000;            // "เพิ่งกลับมาที่แอป"
const RESUME_KEY = 'tet:update-resume';

let registration = null;
let waiting = false;
let reloading = false;
let lastCheck = 0;
let lastInput = Date.now();
let shownAt = Date.now();
let interactedSinceShown = false;
let timer = null;

/** ลงทะเบียน service worker และเริ่มดูการอัปเดต */
export function setupUpdates(app) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // เปิดแอปครั้งแรก (ยังไม่มี service worker) ไม่ใช่การอัปเดต — ไม่ต้องโหลดใหม่
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    remember(app);
    location.reload();
  });

  for (const type of ['pointerdown', 'keydown', 'input']) {
    window.addEventListener(type, () => {
      lastInput = Date.now();
      interactedSinceShown = true;
    }, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    shownAt = Date.now();
    interactedSinceShown = false;
    check();
    tryApply(app);
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      registration = reg;
      lastCheck = Date.now();
      if (reg.waiting && navigator.serviceWorker.controller) markWaiting(app);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) markWaiting(app);
        });
      });
    }).catch((err) => console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err));
  });
  // เปิดค้างไว้นาน ๆ ก็ยังตรวจเป็นระยะ
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, CHECK_EVERY);
}

/** บอกผลการอัปเดตครั้งก่อน และพาไปหน้าที่เปิดอยู่ก่อนโหลดใหม่ — เรียกตอนเริ่มแอป */
export function resumeAfterUpdate(app) {
  let saved = null;
  try {
    saved = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
  } catch { /* ไม่เป็นไร */ }
  if (!saved) return;
  if (['day', 'month', 'year', 'settings', 'split'].includes(saved) && saved !== app.current.name) {
    app.stack = saved === 'split' && app.current.name === 'day'
      ? [{ name: 'day', options: {} }, { name: 'split', options: {} }]
      : [{ name: saved, options: {} }];
  }
  setTimeout(() => toast('อัปเดตเป็นเวอร์ชันใหม่แล้ว'), 400);
}

/**
 * ตรวจเดี๋ยวนี้ (ปุ่มในตั้งค่า) — คนกดเองจึงอัปเดตได้ทันทีแม้มีอะไรเปิดอยู่
 * @returns {Promise<'updating'|'latest'|'offline'|'unsupported'>}
 */
export async function checkNow(app) {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  // ตัวใหม่ใช้เวลาดาวน์โหลดสักครู่
  const worker = registration.installing;
  if (worker) {
    await new Promise((resolve) => {
      const done = () => { if (worker.state !== 'installing') resolve(); };
      worker.addEventListener('statechange', done);
      setTimeout(resolve, 15000);
    });
  }
  if (registration.waiting) {
    apply(app);
    return 'updating';
  }
  return 'latest';
}

/** ชื่อเวอร์ชัน (ชื่อแคชของ service worker ที่ใช้อยู่) */
export function currentVersion() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(typeof e.data?.version === 'string' ? e.data.version : null);
    controller.postMessage({ type: 'version' }, [channel.port2]);
    setTimeout(() => resolve(null), 2000);
  });
}

function check() {
  if (!registration || Date.now() - lastCheck < CHECK_EVERY) return;
  lastCheck = Date.now();
  registration.update().catch(() => { /* ออฟไลน์ ไว้คราวหน้า */ });
}

function markWaiting(app) {
  waiting = true;
  tryApply(app);
}

/** อัปเดตถ้าตอนนี้ปลอดภัย ไม่งั้นรอแล้วลองใหม่ */
function tryApply(app) {
  clearTimeout(timer);
  if (!waiting || reloading) return;
  const justReturned = Date.now() - shownAt < FRESH_MS && !interactedSinceShown;
  const idle = Date.now() - lastInput > IDLE_MS;
  // อยู่เบื้องหลัง = ไม่มีใครดูอยู่ แต่ฟอร์มที่พิมพ์ค้างไว้ยังต้องไม่หาย
  if ((document.visibilityState === 'hidden' || justReturned || idle) && safe(app)) {
    apply(app);
    return;
  }
  timer = setTimeout(() => tryApply(app), 5000);
}

/** ไม่มีอะไรที่จะหายถ้าโหลดใหม่ */
export function safe(app) {
  if (document.querySelector('.sheet-wrap')) return false;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return false;
  if (['log', 'slips', 'sort'].includes(app.current.name)) return false;
  if (app.state.splitSelected?.size > 0) return false;
  return true;
}

function apply(app) {
  const worker = registration?.waiting;
  if (!worker || reloading) return;
  remember(app);
  worker.postMessage({ type: 'skip-waiting' });
  // controllerchange จะโหลดหน้าใหม่ให้
}

function remember(app) {
  try { sessionStorage.setItem(RESUME_KEY, app.current.name); } catch { /* ไม่เป็นไร */ }
}
