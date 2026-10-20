// จุดเริ่มต้นของแอป — ประกอบ store, เส้นทางระหว่างหน้า และแถบล่าง

import { el, replace, $ } from './dom.js';
import { LocalStorageAdapter } from './storage.js';
import { Store } from './store.js';
import { todayISO, entryDayISO, monthKeyOf } from './format.js';
import { toast } from './ui.js';
import { icon, ensureIconSprite } from './icons.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { renderDay } from './screens/home.js';
import { renderLog } from './screens/log.js';
import { renderMonth } from './screens/month.js';
import { renderYear } from './screens/year.js';
import { renderSettings } from './screens/settings.js';
import { renderSort } from './screens/sort.js';
import { renderSlips } from './screens/slips.js';
import { renderSplit } from './screens/split.js';
import { SplitService } from './split-service.js';
import { handleSignInLinkOnLoad } from './screens/sync-ui.js';
import { SyncManager } from './sync.js';
import { SYNC_ENABLED } from './firebase-config.js';

const BACKUP_REMINDER_DAYS = 14;
const BACKUP_SNOOZE_DAYS = 7;
const SNOOZE_KEY = 'tet:backup-snooze-until';

/**
 * การซ่อนคำเตือนเป็นเรื่องของเครื่องนี้ ไม่ต้องซิงก์ จึงเก็บใน localStorage
 * ถ้าเครื่องไม่ยอมให้เก็บ (โหมดส่วนตัว ฯลฯ) ก็ยังซ่อนได้จนกว่าจะปิดแอป
 */
function backupSnoozed() {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snoozeBackup() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + BACKUP_SNOOZE_DAYS * 86400000));
  } catch { /* ซ่อนไว้แค่รอบนี้ */ }
}

/**
 * หน้าหลักสี่หน้าในแถบแท็บล่าง — ปุ่ม + อยู่ตรงกลางระหว่างสองฝั่ง
 */
const PAGES = [
  { id: 'day', label: 'วัน', icon: 'sun' },
  { id: 'month', label: 'เดือน', icon: 'calendar' },
  { id: 'year', label: 'ปี', icon: 'bars' },
  { id: 'settings', label: 'ตั้งค่า', icon: 'sliders' },
];

class App {
  constructor(store) {
    this.store = store;
    this.root = $('#app');
    this.bar = $('#bottom-bar');
    this.stack = [{ name: 'day', options: {} }];
    this.sync = null; // SyncManager จะถูกใส่ให้ทีหลัง (ไม่บล็อกการเปิดแอป)
    this.state = {
      dayISO: entryDayISO(),
      monthKey: monthKeyOf(todayISO()),
      year: Number(todayISO().slice(0, 4)),
      monthSections: new Set(['budget', 'income', 'savings']),
      monthTab: 'expense',
      yearTab: 'expense',
      dismissedBackupBanner: false,
    };
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
    if (PAGES.some((p) => p.id === name) || this.partnerMode) this.stack = [{ name, options }];
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

  /** บัญชีของอีกคนในหารกัน — เห็นแค่หน้าหารกันกับตั้งค่า ไม่มีข้อมูลรายรับรายจ่ายส่วนตัว */
  get partnerMode() {
    return this.split?.role === 'partner';
  }

  render() {
    if (this.partnerMode && !['split', 'settings'].includes(this.current.name)) {
      this.stack = [{ name: 'split', options: {} }];
    }
    const { name, options } = this.current;
    document.body.classList.remove('has-split-select');
    const screens = {
      day: renderDay,
      log: renderLog,
      month: renderMonth,
      year: renderYear,
      settings: renderSettings,
      sort: renderSort,
      slips: renderSlips,
      split: renderSplit,
    };
    replace(this.root, screens[name](this, options));
    this.root.scrollTop = 0;
    this.renderBar(name);
    document.body.dataset.screen = name;
  }

  renderBar(name) {
    // หน้าบันทึกรายการเป็นฟอร์ม มีปุ่มยกเลิก/บันทึกของตัวเอง
    // ถ้าโผล่ปุ่มเปลี่ยนหน้ามาด้วยจะกดพลาดแล้วข้อมูลที่พิมพ์ไว้หาย
    // หน้าจัดประเภทเป็นงานที่ทำต่อเนื่อง มีปุ่ม "เสร็จ" ของตัวเอง
    if (name === 'log' || name === 'sort' || name === 'slips' || name === 'split' || this.partnerMode) {
      replace(this.bar);
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    const tab = (page) => el('button', {
      class: `tab ${page.id === name ? 'tab-on' : ''}`, type: 'button',
      'aria-current': page.id === name ? 'page' : null,
      // แตะ "วัน" ซ้ำ (หรือจากหน้าอื่น) ให้กลับมาที่วันนี้เสมอ
      onclick: () => this.go(page.id, page.id === 'day' ? { reset: true } : {}),
    },
      icon(page.icon, { size: 24 }),
      el('span', { class: 'tab-label' }, page.label),
    );
    replace(this.bar,
      tab(PAGES[0]), tab(PAGES[1]),
      el('button', {
        class: 'tab-add', type: 'button', 'aria-label': 'บันทึกรายการ',
        onclick: () => this.openLog({
          kind: 'expense',
          date: name === 'day' ? this.state.dayISO : entryDayISO(),
        }),
      }, icon('plus', { size: 28 })),
      tab(PAGES[2]), tab(PAGES[3]),
    );
  }

  /**
   * แจ้งผลพร้อมปุ่ม "เลิกทำ"
   * entries = [{ id, before }] ตาม Store.revert
   */
  notifyUndoable(message, entries, revert = (e) => this.store.revert(e)) {
    toast(message, {
      action: {
        label: 'เลิกทำ',
        onClick: async () => {
          await revert(entries);
          // หน้าบันทึกเป็นฟอร์มที่อาจพิมพ์ค้างอยู่ — ห้ามวาดใหม่ทับ
          if (this.current.name !== 'log') this.render();
          toast('ย้อนกลับแล้ว');
        },
      },
    });
  }

  /** แถบเตือนให้สำรองข้อมูล — ขึ้นเฉพาะตอนที่ห่างจากครั้งล่าสุดนานแล้ว */
  backupBanner() {
    if (this.state.dismissedBackupBanner || backupSnoozed()) return null;
    if (this.store.active.length === 0) return null;

    const last = this.store.settings.lastBackupAt;
    const lastMs = last ? Date.parse(last) : null;
    const days = lastMs ? Math.floor((Date.now() - lastMs) / 86400000) : null;
    if (days !== null && days < BACKUP_REMINDER_DAYS) return null;

    return el('div', { class: 'banner' },
      el('div', { class: 'banner-text' },
        el('strong', {}, 'ถึงเวลาสำรองข้อมูลแล้ว'),
        el('span', {}, days === null
          ? 'ยังไม่เคยสำรองข้อมูล'
          : `ครั้งล่าสุดผ่านมา ${days} วัน`),
      ),
      el('div', { class: 'banner-actions' },
        el('button', {
          class: 'btn btn-small btn-primary', type: 'button',
          onclick: () => this.go('settings'),
        }, 'สำรองเลย'),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': `ซ่อนคำเตือน ${BACKUP_SNOOZE_DAYS} วัน`,
          onclick: () => {
            // เดิมกดปิดแล้วเปิดแอปใหม่ก็กลับมาทุกครั้ง — เก็บไว้ในเครื่องให้เงียบ 7 วันจริง
            this.state.dismissedBackupBanner = true;
            snoozeBackup();
            this.render();
            toast(`จะเตือนอีกครั้งใน ${BACKUP_SNOOZE_DAYS} วัน`);
          },
        }, icon('close', { size: 20 })),
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

  applyTheme();
  watchSystemTheme();
  ensureIconSprite();
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
  startSplit(app);
  try {
    const sync = new SyncManager(app.store);
    app.sync = sync;
    // อีกคนในหารกันไม่มีข้อมูลส่วนตัวบนคลาวด์ — รอให้รู้ก่อนว่าเป็นใคร แล้วค่อยซิงก์
    sync.allowPersonal = async () => {
      await app.split?.whenSettled();
      return app.split?.role !== 'partner';
    };
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

/** หารกัน: ฟังรายการที่ใช้ร่วมกันแบบเรียลไทม์ แล้ววาดหน้าที่เกี่ยวข้องใหม่ */
function startSplit(app) {
  const split = new SplitService();
  app.split = split;
  let lastRole = null;
  split.addEventListener('change', () => {
    const role = split.role;
    const roleChanged = role !== lastRole;
    lastRole = role;
    const here = app.current.name;
    // ไม่วาดทับฟอร์มที่กำลังพิมพ์อยู่
    if (here === 'log' || here === 'slips') return;
    // แผ่นฟอร์มที่เปิดอยู่ลอยอยู่เหนือหน้าจอ (อยู่นอก #app) วาดหน้าข้างใต้ใหม่ได้โดยไม่กระทบ
    if (roleChanged || here === 'split' || here === 'day' || here === 'settings') app.render();
  });
  split.addEventListener('write-error', (e) => toast(`หารกัน: ${e.detail}`));
  split.start().catch((err) => console.warn('เริ่มหารกันไม่สำเร็จ', err));
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
