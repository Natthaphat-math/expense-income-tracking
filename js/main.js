// จุดเริ่มต้นของแอป — ประกอบ store, เส้นทางระหว่างหน้า และแถบล่าง

import { el, replace, $ } from './dom.js';
import { LocalStorageAdapter } from './storage.js';
import { Store } from './store.js';
import { todayISO, monthKeyOf } from './format.js';
import { toast } from './ui.js';
import { renderHome } from './screens/home.js';
import { renderLog } from './screens/log.js';
import { renderMonth } from './screens/month.js';
import { renderYear } from './screens/year.js';
import { renderSettings } from './screens/settings.js';
import { handleSignInLinkOnLoad } from './screens/sync-ui.js';
import { SyncManager } from './sync.js';
import { SYNC_ENABLED } from './firebase-config.js';

const BACKUP_REMINDER_DAYS = 14;

class App {
  constructor(store) {
    this.store = store;
    this.root = $('#app');
    this.bar = $('#bottom-bar');
    this.stack = [{ name: 'home', options: {} }];
    this.sync = null; // SyncManager จะถูกใส่ให้ทีหลัง (ไม่บล็อกการเปิดแอป)
    this.state = {
      monthKey: monthKeyOf(todayISO()),
      year: Number(todayISO().slice(0, 4)),
      monthSections: new Set(['budget']),
      dismissedBackupBanner: false,
    };
    // หน้าไหนก็ตามที่ข้อมูลเปลี่ยน ให้วาดใหม่ เพื่อไม่ต้องจำว่าใครต้องรีเฟรชบ้าง
    this.store.addEventListener('change', () => {
      if (this.current.name === 'home') this.render();
    });
  }

  get current() {
    return this.stack[this.stack.length - 1];
  }

  go(name, options = {}) {
    this.stack.push({ name, options });
    this.render();
  }

  back() {
    if (this.stack.length > 1) this.stack.pop();
    this.render();
  }

  openLog(options) {
    this.go('log', options);
  }

  render() {
    const { name, options } = this.current;
    const screens = {
      home: renderHome,
      log: renderLog,
      month: renderMonth,
      year: renderYear,
      settings: renderSettings,
    };
    replace(this.root, screens[name](this, options));
    this.root.scrollTop = 0;
    this.renderBar(name);
    document.body.dataset.screen = name;
  }

  renderBar(name) {
    // แถบล่างอยู่เฉพาะหน้าหลัก หน้าอื่นมีปุ่มย้อนกลับของตัวเองอยู่แล้ว
    if (name !== 'home') {
      replace(this.bar);
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    replace(this.bar,
      el('button', {
        class: 'bar-side', type: 'button',
        onclick: () => this.go('year', { year: this.state.year }),
      }, 'ปี'),
      el('div', { class: 'bar-center' },
        el('button', {
          class: 'bar-main bar-income', type: 'button',
          onclick: () => this.openLog({ kind: 'income' }),
        }, 'รับ'),
        el('button', {
          class: 'bar-main bar-expense', type: 'button',
          onclick: () => this.openLog({ kind: 'expense' }),
        }, 'จ่าย'),
      ),
      el('button', {
        class: 'bar-side', type: 'button',
        onclick: () => this.go('month', { monthKey: this.state.monthKey }),
      }, 'เดือน'),
    );
  }

  /** แถบเตือนให้สำรองข้อมูล — ขึ้นเฉพาะตอนที่ห่างจากครั้งล่าสุดนานแล้ว */
  backupBanner() {
    if (this.state.dismissedBackupBanner) return null;
    if (this.store.active.length === 0) return null;

    const last = this.store.settings.lastBackupAt;
    const lastMs = last ? Date.parse(last) : null;
    const days = lastMs ? Math.floor((Date.now() - lastMs) / 86400000) : null;
    if (days !== null && days < BACKUP_REMINDER_DAYS) return null;

    return el('div', { class: 'banner' },
      el('div', { class: 'banner-text' },
        el('strong', {}, 'ถึงเวลาสำรองข้อมูลแล้ว'),
        el('span', {}, days === null
          ? 'ยังไม่เคยส่งออกไฟล์สำรองเลย'
          : `ครั้งล่าสุดผ่านมา ${days} วัน`),
      ),
      el('div', { class: 'banner-actions' },
        el('button', {
          class: 'btn btn-small btn-primary', type: 'button',
          onclick: () => this.go('settings'),
        }, 'สำรองเลย'),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'ปิดคำเตือน',
          onclick: () => { this.state.dismissedBackupBanner = true; this.render(); },
        }, '✕'),
      ),
    );
  }
}

async function boot() {
  const store = new Store(new LocalStorageAdapter());
  try {
    await store.load();
  } catch (err) {
    console.error('โหลดข้อมูลไม่สำเร็จ', err);
    replace($('#app'), el('div', { class: 'fatal' },
      el('p', {}, 'เปิดข้อมูลไม่สำเร็จ'),
      el('p', {}, 'ลองปิดแล้วเปิดแอปใหม่อีกครั้ง'),
    ));
    return;
  }

  const app = new App(store);
  globalThis.__app = app; // ช่วยตรวจสอบตอนพัฒนา
  app.render();

  requestPersistentStorage();
  registerServiceWorker();
  startSync(app);
}

/**
 * เริ่มการซิงก์แบบเงียบ ๆ — ห้ามให้ขั้นตอนนี้ทำให้แอปเปิดไม่ขึ้น
 * ถ้าไม่มีเน็ตหรือโหลด Firebase ไม่ได้ แอปก็ทำงานด้วย localStorage ตามปกติ
 */
async function startSync(app) {
  if (!SYNC_ENABLED) return;
  try {
    const sync = new SyncManager(app.store);
    app.sync = sync;
    // สถานะซิงก์เปลี่ยน ให้หน้าตั้งค่าที่เปิดอยู่อัปเดตตาม
    sync.addEventListener('status', () => {
      if (app.current.name === 'settings') app.render();
    });
    await sync.start();
    await handleSignInLinkOnLoad(app);
  } catch (err) {
    console.warn('เริ่มการซิงก์ไม่สำเร็จ — ใช้งานในเครื่องต่อไป', err);
  }
}

/** ขอให้เบราว์เซอร์อย่าเก็บกวาดข้อมูลของเราทิ้งเมื่อพื้นที่ใกล้เต็ม */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    const already = await navigator.storage.persisted();
    if (!already) await navigator.storage.persist();
  } catch (err) {
    console.warn('ขอพื้นที่เก็บถาวรไม่สำเร็จ', err);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err);
    });
  });
}

boot();
