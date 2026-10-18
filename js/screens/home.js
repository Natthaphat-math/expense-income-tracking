// หน้าวัน — ยอดที่ใช้ไป กราฟสัปดาห์ ปุ่มบันทึกด่วน และรายการของวันนั้น

import { el } from '../dom.js';
import {
  formatMoney, formatNumber, longDate, todayISO, entryDayISO, isLateNight, relativeDate,
  weekDays, weekdayShort, weekRangeLabel, fromISODate,
} from '../format.js';
import {
  summarize, activeCategories, groupForCategory, groupKind, GROUPS,
} from '../model.js';
import { openPicker, pageHeader } from '../ui.js';
import { icon, categoryTile } from '../icons.js';

const WEEKDAY_LONG = new Intl.DateTimeFormat('th-TH-u-ca-gregory', { weekday: 'long' });

/** คำทักตามช่วงเวลาของเครื่อง */
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'สวัสดีตอนเช้า';
  if (h >= 12 && h < 17) return 'สวัสดีตอนบ่าย';
  if (h >= 17 && h < 21) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

export function renderDay(app) {
  // เปิดจากแท็บ "วัน" ให้เด้งกลับมาวันนี้ — ครั้งเดียว ไม่งั้นแตะแท่งวันอื่นแล้วจะเด้งกลับทุกครั้ง
  if (app.current.options?.reset) {
    app.state.dayISO = entryDayISO();
    app.current.options.reset = false;
  }

  const today = todayISO();
  const day = app.state.dayISO ?? today;
  const isToday = day === today;
  const rows = app.store.byDate(day);

  return el('div', { class: 'screen screen-day' },
    pageHeader({
      kicker: longDate(day),
      title: isToday ? greeting() : relativeDate(day),
      actions: isToday
        ? []
        : [el('button', {
            class: 'btn btn-small btn-tonal', type: 'button',
            onclick: () => { app.state.dayISO = today; app.render(); },
          }, 'กลับไปวันนี้')],
    }),
    // หลังเที่ยงคืน แอปเปิดวันของเมื่อวานให้ก่อน — บอกไว้ให้รู้ว่าทำไม
    isLateNight() && day === entryDayISO() && !isToday
      ? el('p', { class: 'night-note' }, 'เลยเที่ยงคืนแล้ว แสดงของเมื่อวานให้ก่อน รายการที่เพิ่มจะลงเป็นของเมื่อวาน')
      : null,
    summaryCard(app, day, rows),
    app.backupBanner(),
    sortPrompt(app),
    quickAdd(app, day),
    el('section', { class: 'day-list' },
      el('div', { class: 'section-head' },
        el('h2', { class: 'section-title' }, isToday ? 'รายการวันนี้' : 'รายการของวันนั้น'),
        rows.length > 0 ? el('span', { class: 'section-meta' }, `${formatNumber(rows.length)} รายการ`) : null,
      ),
      rows.length === 0
        ? emptyState(isToday)
        : el('ul', { class: 'tx-list' }, rows.map((tx) => transactionRow(app, tx))),
    ),
  );
}

/**
 * การ์ดสรุปด้านบน: ใช้ไปเท่าไร รับเท่าไร และแท่งรายจ่าย 7 วันของสัปดาห์ (เริ่มวันจันทร์)
 * แตะแท่งของวันไหนเพื่อเปลี่ยนไปดูวันนั้น
 */
function summaryCard(app, day, rows) {
  const today = todayISO();
  const isToday = day === today;
  const { income, expense } = summarize(rows);
  const days = weekDays(day).map((date) => {
    const list = app.store.byDate(date);
    const t = summarize(list);
    return { date, income: t.income, expense: t.expense, logged: list.length > 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.expense));
  const week = days.reduce((acc, d) => ({
    income: acc.income + d.income, expense: acc.expense + d.expense,
  }), { income: 0, expense: 0 });
  const elapsed = days.filter((d) => d.date <= today);
  const logged = elapsed.filter((d) => d.logged).length;

  return el('section', { class: 'hero-card', 'aria-label': 'สรุปของวัน' },
    el('div', { class: 'hero-top' },
      el('div', { class: 'hero-main' },
        el('p', { class: 'hero-label' }, isToday ? 'ใช้ไปวันนี้' : 'ใช้ไปวันนั้น'),
        el('p', { class: 'hero-amount' },
          formatNumber(expense),
          el('span', { class: 'hero-unit' }, ' บาท'),
        ),
      ),
      income > 0
        ? el('p', { class: 'hero-income' },
            el('span', { class: 'hero-income-label' }, 'รับ'),
            ` +${formatNumber(income)} บาท`)
        : null,
    ),
    el('div', { class: 'week', role: 'group', 'aria-label': `รายจ่ายสัปดาห์ ${weekRangeLabel(day)}` },
      days.map((d) => {
        const selected = d.date === day;
        return el('button', {
          class: [
            'week-day',
            selected ? 'week-day-on' : '',
            d.date === today ? 'week-day-today' : '',
            d.date > today ? 'week-day-future' : '',
          ].join(' ').replace(/\s+/g, ' ').trim(),
          type: 'button',
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': `${WEEKDAY_LONG.format(fromISODate(d.date))} ${relativeDate(d.date)} ใช้ไป ${formatMoney(d.expense)}`
            + (d.income > 0 ? ` รับ ${formatMoney(d.income)}` : ''),
          onclick: () => { app.state.dayISO = d.date; app.render(); },
        },
          el('span', { class: 'week-track', 'aria-hidden': 'true' },
            el('span', {
              class: 'week-bar',
              // วันที่ไม่มีรายจ่ายยังเหลือแท่งเตี้ย ๆ ให้เห็นว่ามีวันนั้นอยู่
              style: { height: `${Math.max(8, Math.round((d.expense / max) * 100))}%` },
            }),
          ),
          el('span', { class: 'week-label', 'aria-hidden': 'true' }, weekdayShort(d.date)),
        );
      }),
    ),
    el('p', { class: 'hero-foot' },
      `สัปดาห์นี้ใช้ไป ${formatMoney(week.expense)}`,
      week.income > 0 ? ` · รับ ${formatMoney(week.income)}` : null,
    ),
    elapsed.length > 0 && logged < elapsed.length
      ? el('p', { class: 'hero-note' }, `บันทึกไปแล้ว ${logged} จาก ${elapsed.length} วันที่ผ่านมา`)
      : null,
  );
}

/** ชวนไปจัดประเภท เมื่อยังมีรายการที่ไม่ระบุประเภท */
function sortPrompt(app) {
  const count = app.store.untypedCount;
  if (count === 0) return null;
  return el('button', { class: 'sort-prompt', type: 'button', onclick: () => app.go('sort') },
    categoryTile(null, 'DE', { size: 'sm' }),
    el('span', { class: 'sort-prompt-text' },
      el('strong', {}, `ยังไม่ระบุประเภท ${formatNumber(count)} รายการ`),
      el('span', {}, 'จัดทีละชื่อ ครั้งเดียวได้ทุกรายการ'),
    ),
    el('span', { class: 'sort-prompt-go' }, 'จัดประเภท', icon('chevronRight', { size: 18 })),
  );
}

/** ปุ่มลัดของรายการที่บันทึกบ่อย — แตะแล้วเปิดฟอร์มที่กรอกไว้ให้ ตรวจแล้วกดบันทึก */
function quickAdd(app, day) {
  const items = app.store.frequentItems(8);
  if (items.length === 0) return null;
  return el('section', { class: 'quick' },
    el('h2', { class: 'section-title' }, 'บันทึกด่วน'),
    el('div', { class: 'quick-row' }, items.map((item) => el('button', {
      class: 'quick-chip', type: 'button',
      'aria-label': `บันทึก ${item.name}${item.amount !== null ? ` ${formatMoney(item.amount)}` : ''}`,
      onclick: () => app.openLog({
        kind: item.kind,
        date: day,
        prefill: { name: item.name, amount: item.amount, type: item.type },
      }),
    },
      categoryTile(item.type, item.group, { size: 'sm' }),
      el('span', { class: 'quick-name' }, item.name),
      item.amount !== null
        ? el('span', { class: `quick-amount ${item.kind === 'income' ? 'is-income' : ''}` }, formatNumber(item.amount))
        : null,
    ))),
  );
}

function emptyState(isToday) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty-mark', 'aria-hidden': 'true' }, icon('list', { size: 28 })),
    el('p', { class: 'empty-title' }, isToday ? 'วันนี้ยังไม่มีรายการ' : 'วันนั้นไม่มีรายการที่บันทึกไว้'),
    el('p', { class: 'empty-hint' }, 'แตะปุ่ม + ด้านล่างเพื่อเริ่มบันทึก'),
    el('p', { class: 'empty-hint' }, 'พิมพ์สั้น ๆ ได้เลย เช่น “ก๋วยเตี๋ยว 20 บาท อาหาร”'),
  );
}

/**
 * แถวรายการหนึ่งรายการ
 * @param {object} options
 * @param {boolean} options.compact      แถวเตี้ย ไอคอนเล็ก สำหรับรายการยาว ๆ ของหน้าเดือน
 * @param {boolean} options.selectable   อยู่ในโหมดเลือกหลายรายการ
 * @param {boolean} options.selected     ถูกเลือกอยู่หรือไม่
 * @param {Function} options.onToggle    เรียกเมื่อแตะในโหมดเลือก
 * @param {Function} options.onChanged   เรียกหลังตั้งประเภทจากแถว (สำหรับหน้าที่ไม่วาดใหม่เองเมื่อข้อมูลเปลี่ยน)
 */
export function transactionRow(app, tx, {
  compact = false, selectable = false, selected = false, onToggle = null, onChanged = null,
} = {}) {
  const isIncome = tx.kind === 'income';
  const sign = isIncome ? '+' : '−';
  const untyped = !tx.type;

  const classes = ['tx-row', `tx-${isIncome ? 'income' : 'expense'}`];
  if (compact) classes.push('tx-row-compact');
  if (selectable && selected) classes.push('tx-row-selected');
  // ประเภทว่าง: วงกลมเป็นปุ่มแยก แตะแล้วเลือกประเภทได้ทันทีโดยไม่ต้องเปิดฟอร์ม
  const tileButton = untyped && !selectable;
  if (tileButton) classes.push('tx-row-untyped');

  // หน้าเดือนมีรายการไม่ระบุประเภทเรียงกันยาว คำชวนแตะซ้ำทุกแถวจะรก จึงบอกแค่สถานะ
  const subtitle = untyped
    ? el('span', { class: `tx-sub ${tileButton && !compact ? 'tx-sub-action' : ''}` },
        tileButton && !compact ? 'แตะ ? เพื่อเลือกประเภท' : 'ไม่ระบุประเภท')
    : el('span', { class: 'tx-sub' }, tx.type);

  return el('li', { class: classes.join(' ') },
    tileButton
      ? el('button', {
          class: 'tx-tile-button', type: 'button',
          'aria-label': `เลือกประเภทให้ “${tx.name}”`,
          onclick: () => pickTypeFor(app, tx, onChanged),
        }, categoryTile(null, tx.group, { size: compact ? 'sm' : 'md' }))
      : null,
    el('button', {
      class: 'tx-button', type: 'button',
      // ในโหมดเลือก การแตะคือการติ๊ก ไม่ใช่การเปิดหน้าแก้ไข
      'aria-pressed': selectable ? String(selected) : null,
      onclick: () => (selectable ? onToggle?.(tx) : openRowActions(app, tx)),
    },
      selectable
        ? el('span', { class: `tx-check ${selected ? 'tx-check-on' : ''}`, 'aria-hidden': 'true' },
            selected ? icon('check', { size: 16 }) : null)
        : null,
      tileButton ? null : categoryTile(tx.type, tx.group, { size: compact ? 'sm' : 'md' }),
      el('span', { class: 'tx-main' },
        el('span', { class: 'tx-name' }, tx.name),
        subtitle,
      ),
      tx.amount === null
        ? el('span', { class: 'tx-amount tx-amount-missing' }, 'ยังไม่ระบุมูลค่า')
        : el('span', { class: 'tx-amount' },
            el('span', { class: 'visually-hidden' }, isIncome ? 'รับ ' : 'จ่าย '),
            `${sign}${formatNumber(tx.amount)}`),
    ),
  );
}

/** เลือกประเภทจากแถวรายการโดยตรง */
function pickTypeFor(app, tx, onChanged) {
  const cats = activeCategories(app.store.settings, { kind: tx.kind });
  openPicker({
    title: `ประเภทของ “${tx.name}”`,
    items: cats.map((c) => ({ label: c.name, value: c.name, group: c.group, aliases: c.aliases, tile: true })),
    searchPlaceholder: 'ค้นหาประเภท',
    groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
    onSelect: async (name) => {
      const group = groupForCategory(app.store.settings, name, tx.kind);
      const before = app.store.byId(tx.id);
      await app.store.save({ ...tx, type: name, group, kind: groupKind(group) });
      onChanged?.();
      app.notifyUndoable(`ตั้งประเภท “${name}” แล้ว`, [{ id: tx.id, before }]);
    },
  });
}

function openRowActions(app, tx) {
  app.openLog({ mode: 'edit', transaction: tx });
}

/** ลบทันทีโดยไม่ถามซ้ำ — กดพลาดก็เลิกทำได้จากข้อความที่ขึ้นมา */
export async function deleteTransaction(app, tx) {
  const before = app.store.byId(tx.id) ?? tx;
  await app.store.remove(tx.id);
  app.notifyUndoable(`ลบ “${tx.name}” แล้ว`, [{ id: tx.id, before }]);
  return true;
}
