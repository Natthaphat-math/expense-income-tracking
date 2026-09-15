// จุดเริ่มต้นของแอป — ประกอบ store, เส้นทางระหว่างหน้า และแถบล่าง

import { el, replace, $ } from './dom.js';
import { LocalStorageAdapter } from './storage.js';
import { Store } from './store.js';
import { todayISO, monthKeyOf, monthTitle, shiftMonthKey } from './format.js';
import { toast, openMonthPicker } from './ui.js';
import { renderDay } from './screens/home.js';
import { renderLog } from './screens/log.js';
import { renderMonth } from './screens/month.js';
import { renderYear } from './screens/year.js';
import { renderSettings } from './screens/settings.js';
import { handleSignInLinkOnLoad } from './screens/sync-ui.js';
import { SyncManager } from './sync.js';
import { SYNC_ENABLED } from './firebase-config.js';

const BACKUP_REMINDER_DAYS = 14;

/**
 * หน้าหลักของแอป
 * label    = ชื่อที่โชว์บนปุ่มวงกลมตอนอยู่หน้านั้น
 * menuLabel = ชื่อในเมนูตอนกางขึ้นมา (เป็นคำสั่งไปหน้านั้น)
 */
const PAGES = [
  { id: 'day', label: 'วัน', menuLabel: 'วันนี้', mark: '☀' },
  { id: 'month', label: 'เดือน', menuLabel: 'เดือน', mark: '▦' },
  { id: 'year', label: 'ปี', menuLabel: 'ปี', mark: '▤' },
  { id: 'settings', label: '⚙', menuLabel: 'ตั้งค่า', mark: '⚙' },
];

class App {
  constructor(store) {
    this.store = store;
    this.root = $('#app');
    this.bar = $('#bottom-bar');
    this.stack = [{ name: 'day', options: {} }];
    this.sync = null; // SyncManager จะถูกใส่ให้ทีหลัง (ไม่บล็อกการเปิดแอป)
    this.state = {
      dayISO: todayISO(),
      monthKey: monthKeyOf(todayISO()),
      year: Number(todayISO().slice(0, 4)),
      monthSections: new Set(['budget']),
      monthTab: 'expense',
      yearTab: 'expense',
      dismissedBackupBanner: false,
    };
    this.menuOpen = false;
    // หน้าไหนก็ตามที่ข้อมูลเปลี่ยน ให้วาดใหม่ เพื่อไม่ต้องจำว่าใครต้องรีเฟรชบ้าง
    this.store.addEventListener('change', () => {
      if (this.current.name === 'day') this.render();
    });
  }

  get current() {
    return this.stack[this.stack.length - 1];
  }

  /** หน้าหลักสี่หน้าสลับกันตรง ๆ ไม่ซ้อนกัน จึงไม่ต้องมีปุ่มย้อนกลับ */
  go(name, options = {}) {
    this.menuOpen = false;
    if (PAGES.some((p) => p.id === name)) this.stack = [{ name, options }];
    else this.stack.push({ name, options });
    this.render();
  }

  /** ปิดหน้าที่ซ้อนอยู่ (เช่นหน้าบันทึกรายการ) กลับไปหน้าหลักที่เปิดไว้ */
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
      day: renderDay,
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
    // หน้าบันทึกรายการเป็นฟอร์ม มีปุ่มยกเลิก/บันทึกของตัวเอง
    // ถ้าโผล่ปุ่มเปลี่ยนหน้ามาด้วยจะกดพลาดแล้วข้อมูลที่พิมพ์ไว้หาย
    if (name === 'log') {
      replace(this.bar);
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    replace(this.bar, this.pageButton(name), this.pageControls(name));
    this.renderNavBackdrop();
  }

  /**
   * ฉากหลังสำหรับปิดเมนู วางไว้ที่ body ไม่ใช่ในแถบล่าง
   * เพราะแถบล่างใช้ backdrop-filter ซึ่งทำให้ลูกที่ position: fixed
   * ยึดขนาดกับแถบแทนที่จะเป็นทั้งหน้าจอ
   */
  renderNavBackdrop() {
    const existing = document.querySelector('.pagenav-backdrop');
    if (!this.menuOpen) {
      existing?.remove();
      return;
    }
    if (existing) return;
    document.body.appendChild(el('div', {
      class: 'pagenav-backdrop',
      onclick: () => { this.menuOpen = false; this.render(); },
    }));
  }

  /**
   * ระหว่างเมนูกางอยู่ ปุ่มอื่นในแถบล่างให้ปิดเมนูก่อน ไม่ทำงานของตัวเอง
   * (ฉากหลังคลุมเนื้อหาได้ แต่คลุมแถบล่างไม่ได้ เพราะแถบอยู่เหนือกว่า)
   */
  guard(fn) {
    return () => {
      if (this.menuOpen) {
        this.menuOpen = false;
        this.render();
        return;
      }
      fn();
    };
  }

  /** ปุ่มวงกลมมุมซ้ายล่าง แตะแล้วกางขึ้นเป็นเมนูเปลี่ยนหน้า */
  pageButton(name) {
    const here = PAGES.find((p) => p.id === name) ?? PAGES[0];
    const others = PAGES.filter((p) => p.id !== here.id);

    return el('div', { class: `pagenav ${this.menuOpen ? 'pagenav-open' : ''}` },
      this.menuOpen
        ? el('div', { class: 'pagenav-menu', role: 'menu' },
            others.map((page) => el('button', {
              class: 'pagenav-item', type: 'button', role: 'menuitem',
              onclick: () => this.go(page.id, page.id === 'day' ? { reset: true } : {}),
            },
              el('span', { class: 'pagenav-item-mark', 'aria-hidden': 'true' }, page.mark),
              el('span', { class: 'pagenav-item-label' }, page.menuLabel),
            )),
          )
        : null,
      el('button', {
        class: 'pagenav-button', type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': this.menuOpen ? 'true' : 'false',
        'aria-label': `หน้า${here.label} — แตะเพื่อเปลี่ยนหน้า`,
        onclick: () => { this.menuOpen = !this.menuOpen; this.render(); },
      },
        el('span', { class: 'pagenav-button-label' }, here.label),
      ),
    );
  }

  /** ตัวควบคุมของแต่ละหน้า ย้ายลงมาอยู่แถบล่างเพื่อไม่ให้เบียดเนื้อหา */
  pageControls(name) {
    if (name === 'day') {
      return el('div', { class: 'bar-center' },
        el('button', {
          class: 'bar-main bar-income', type: 'button',
          onclick: this.guard(() => this.openLog({ kind: 'income', date: this.state.dayISO })),
        }, 'รับ'),
        el('button', {
          class: 'bar-main bar-expense', type: 'button',
          onclick: this.guard(() => this.openLog({ kind: 'expense', date: this.state.dayISO })),
        }, 'จ่าย'),
      );
    }

    if (name === 'month') {
      return el('div', { class: 'bar-stepper' },
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'เดือนก่อนหน้า',
          onclick: this.guard(() => { this.state.monthKey = shiftMonthKey(this.state.monthKey, -1); this.render(); }),
        }, '‹'),
        el('button', {
          class: 'bar-stepper-title', type: 'button',
          onclick: this.guard(() => openMonthPicker({
            value: this.state.monthKey,
            onSelect: (key) => { this.state.monthKey = key; this.render(); },
          })),
        }, monthTitle(this.state.monthKey)),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'เดือนถัดไป',
          onclick: this.guard(() => { this.state.monthKey = shiftMonthKey(this.state.monthKey, 1); this.render(); }),
        }, '›'),
      );
    }

    if (name === 'year') {
      return el('div', { class: 'bar-stepper' },
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'ปีก่อนหน้า',
          onclick: this.guard(() => { this.state.year -= 1; this.render(); }),
        }, '‹'),
        el('span', { class: 'bar-stepper-title bar-stepper-static' }, `ปี ${this.state.year}`),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'ปีถัดไป',
          onclick: this.guard(() => { this.state.year += 1; this.render(); }),
        }, '›'),
      );
    }

    return el('span', { class: 'bar-page-name' }, 'ตั้งค่า');
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
