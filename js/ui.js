// ชิ้นส่วน UI ที่ใช้ร่วมกัน: bottom sheet, toast, กล่องยืนยัน, ตัวเลือกวันที่
// ทุกอย่างสร้างด้วย createElement ไม่มี innerHTML

import { el, replace } from './dom.js';
import {
  todayISO, addDays, fromISODate, toISODate, monthName, monthNameShort,
  longDate, relativeDate, monthKey, parseMonthKey,
} from './format.js';

let sheetStack = [];

/**
 * เปิดแผ่นเลื่อนจากด้านล่าง
 * @returns {{ close: () => void, body: HTMLElement }}
 */
export function openSheet({ title, body, actions = [], onClose = null, fullHeight = false }) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const content = el('div', { class: 'sheet-body' });
  if (body) content.appendChild(body);

  const sheet = el('div', {
    class: `sheet ${fullHeight ? 'sheet-full' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title || 'ตัวเลือก',
  },
    el('div', { class: 'sheet-grip' }),
    el('div', { class: 'sheet-head' },
      el('h2', { class: 'sheet-title' }, title || ''),
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'ปิด', onclick: () => close() }, '✕'),
    ),
    content,
    actions.length > 0 ? el('div', { class: 'sheet-actions' }, actions) : null,
  );

  const wrap = el('div', { class: 'sheet-wrap' }, backdrop, sheet);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  // บังคับให้ browser คำนวณ layout ก่อน เพื่อให้ transition ทำงาน
  requestAnimationFrame(() => wrap.classList.add('sheet-open'));

  function close() {
    if (!wrap.isConnected) return;
    wrap.classList.remove('sheet-open');
    sheetStack = sheetStack.filter((s) => s !== close);
    setTimeout(() => {
      wrap.remove();
      if (sheetStack.length === 0) document.body.classList.remove('no-scroll');
    }, 220);
    if (onClose) onClose();
  }

  backdrop.addEventListener('click', close);
  sheetStack.push(close);
  return { close, body: content, sheet };
}

export function closeTopSheet() {
  const close = sheetStack[sheetStack.length - 1];
  if (close) close();
}

/** ข้อความแจ้งสั้น ๆ ด้านล่างจอ */
export function toast(message, { duration = 2600 } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const node = el('div', { class: 'toast' }, message);
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('toast-in'));
  setTimeout(() => {
    node.classList.remove('toast-in');
    setTimeout(() => node.remove(), 250);
  }, duration);
}

/**
 * กล่องยืนยัน — คืน Promise<boolean>
 */
export function confirmDialog({ title, message, confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const handle = openSheet({
      title,
      body: el('p', { class: 'confirm-message' }, message),
      actions: [
        el('button', {
          class: 'btn btn-ghost', type: 'button',
          onclick: () => { finish(false); handle.close(); },
        }, cancelText),
        el('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button',
          onclick: () => { finish(true); handle.close(); },
        }, confirmText),
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * ตัวเลือกจากรายการ พร้อมช่องค้นหา และกลุ่มหัวข้อ
 * @param {Array<{label, value, group?, hint?}>} items
 */
export function openPicker({
  title,
  items,
  selected = null,
  searchPlaceholder = 'ค้นหา',
  onSelect,
  extraAction = null,
  groupLabels = {},
}) {
  const list = el('div', { class: 'picker-list' });

  const render = (term) => {
    const needle = term.trim().toLowerCase();
    const matches = items.filter((item) => {
      if (!needle) return true;
      if (item.label.toLowerCase().includes(needle)) return true;
      return (item.aliases || []).some((a) => a.toLowerCase().includes(needle));
    });

    if (matches.length === 0) {
      replace(list, el('p', { class: 'picker-empty' }, 'ไม่พบรายการที่ค้นหา'));
      return;
    }

    const groups = new Map();
    for (const item of matches) {
      const key = item.group ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    replace(list, [...groups.entries()].map(([key, rows]) => el('section', { class: 'picker-group' },
      key ? el('h3', { class: 'picker-group-title' }, groupLabels[key] ?? key) : null,
      rows.map((item) => el('button', {
        class: `picker-item ${item.value === selected ? 'picker-item-on' : ''}`,
        type: 'button',
        onclick: () => { handle.close(); onSelect(item.value, item); },
      },
        el('span', { class: 'picker-item-label' }, item.label),
        item.hint ? el('span', { class: 'picker-item-hint' }, item.hint) : null,
        item.value === selected ? el('span', { class: 'picker-check', 'aria-hidden': 'true' }, '✓') : null,
      )),
    )));
  };

  const search = el('input', {
    class: 'input picker-search',
    type: 'search',
    placeholder: searchPlaceholder,
    autocomplete: 'off',
    autocorrect: 'off',
    oninput: (e) => render(e.target.value),
  });

  const body = el('div', { class: 'picker' }, search, list);
  render('');

  const handle = openSheet({
    title,
    body,
    fullHeight: true,
    actions: extraAction ? [extraAction(() => handle.close())] : [],
  });
  return handle;
}

/**
 * ตัวเลือกวันที่ — ปฏิทินรายเดือน พร้อมปุ่มลัด วันนี้ / เมื่อวาน
 */
export function openDatePicker({ value, onSelect, title = 'เลือกวันที่' }) {
  let view = value ? value.slice(0, 7) : todayISO().slice(0, 7);
  const grid = el('div', { class: 'cal-grid' });
  const heading = el('div', { class: 'cal-title' });

  const renderMonth = () => {
    const { year, month } = parseMonthKey(view);
    replace(heading, `${monthName(month)} ${year}`);

    const first = new Date(year, month - 1, 1);
    const lead = (first.getDay() + 6) % 7; // เริ่มสัปดาห์ที่วันจันทร์
    const days = new Date(year, month, 0).getDate();
    const today = todayISO();

    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push(el('span', { class: 'cal-cell cal-blank' }));
    for (let d = 1; d <= days; d += 1) {
      const iso = `${view}-${String(d).padStart(2, '0')}`;
      const classes = ['cal-cell', 'cal-day'];
      if (iso === value) classes.push('cal-day-on');
      if (iso === today) classes.push('cal-day-today');
      cells.push(el('button', {
        class: classes.join(' '), type: 'button',
        onclick: () => { handle.close(); onSelect(iso); },
      }, String(d)));
    }
    replace(grid, cells);
  };

  const step = (delta) => {
    const { year, month } = parseMonthKey(view);
    const index = year * 12 + (month - 1) + delta;
    view = monthKey(Math.floor(index / 12), (index % 12) + 1);
    renderMonth();
  };

  const weekdayRow = el('div', { class: 'cal-weekdays' },
    ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'].map((d) => el('span', { class: 'cal-weekday' }, d)));

  const body = el('div', { class: 'calendar' },
    el('div', { class: 'cal-shortcuts' },
      el('button', { class: 'chip', type: 'button', onclick: () => { handle.close(); onSelect(todayISO()); } }, 'วันนี้'),
      el('button', { class: 'chip', type: 'button', onclick: () => { handle.close(); onSelect(addDays(todayISO(), -1)); } }, 'เมื่อวาน'),
    ),
    el('div', { class: 'cal-head' },
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'เดือนก่อนหน้า', onclick: () => step(-1) }, '‹'),
      heading,
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'เดือนถัดไป', onclick: () => step(1) }, '›'),
    ),
    weekdayRow,
    grid,
  );

  renderMonth();
  const handle = openSheet({ title, body });
  return handle;
}

/**
 * ตัวเลือกเดือน — ตาราง 12 เดือน พร้อมปุ่มเปลี่ยนปี
 */
export function openMonthPicker({ value, onSelect, title = 'เลือกเดือน' }) {
  let year = parseMonthKey(value).year;
  const heading = el('div', { class: 'cal-title' });
  const grid = el('div', { class: 'month-grid' });

  const render = () => {
    replace(heading, `ปี ${year}`);
    replace(grid, Array.from({ length: 12 }, (_, i) => {
      const key = monthKey(year, i + 1);
      return el('button', {
        class: `month-cell ${key === value ? 'month-cell-on' : ''}`,
        type: 'button',
        onclick: () => { handle.close(); onSelect(key); },
      }, monthNameShort(i + 1));
    }));
  };

  const body = el('div', { class: 'month-picker' },
    el('div', { class: 'cal-head' },
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'ปีก่อนหน้า', onclick: () => { year -= 1; render(); } }, '‹'),
      heading,
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'ปีถัดไป', onclick: () => { year += 1; render(); } }, '›'),
    ),
    grid,
  );

  render();
  const handle = openSheet({ title, body });
  return handle;
}

/** ช่องกรอกตัวเลขในแผ่นเลื่อน คืน Promise<number|null> */
export function promptNumber({ title, label, value = '', hint = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const input = el('input', {
      class: 'input',
      type: 'text',
      inputmode: 'decimal',
      value: value === null || value === undefined ? '' : String(value),
      'aria-label': label,
    });

    const submit = () => {
      const raw = input.value.trim().replace(/,/g, '');
      finish(raw === '' ? null : Number(raw));
      handle.close();
    };

    const body = el('div', { class: 'form' },
      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, label),
        input,
      ),
      hint ? el('p', { class: 'field-hint' }, hint) : null,
    );

    const handle = openSheet({
      title,
      body,
      actions: [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { finish(undefined); handle.close(); } }, 'ยกเลิก'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'บันทึก'),
      ],
      onClose: () => finish(undefined),
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 120);
  });
}

/** ช่องกรอกข้อความในแผ่นเลื่อน คืน Promise<string|undefined> */
export function promptText({ title, label, value = '', placeholder = '', hint = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const input = el('input', {
      class: 'input', type: 'text', value: value ?? '', placeholder, 'aria-label': label,
      autocapitalize: 'off', autocorrect: 'off',
    });

    const submit = () => {
      finish(input.value.trim());
      handle.close();
    };

    const body = el('div', { class: 'form' },
      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, label),
        input,
      ),
      hint ? el('p', { class: 'field-hint' }, hint) : null,
    );

    const handle = openSheet({
      title,
      body,
      actions: [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { finish(undefined); handle.close(); } }, 'ยกเลิก'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'บันทึก'),
      ],
      onClose: () => finish(undefined),
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 120);
  });
}

export { longDate, relativeDate };
