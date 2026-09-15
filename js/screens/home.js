// หน้าหลัก — รายการของวันนี้ และยอดรวมวันนี้

import { el, replace } from '../dom.js';
import {
  formatMoney, longDate, todayISO,
  weekDays, weekdayShort, weekRangeLabel,
} from '../format.js';
import { groupedBarChart } from '../charts.js';
import { summarize, groupLabel } from '../model.js';
import { confirmDialog, toast } from '../ui.js';

export function renderDay(app) {
  // เปิดจากเมนู "วันนี้" ให้เด้งกลับมาวันนี้เสมอ
  if (app.current.options?.reset) app.state.dayISO = todayISO();

  const today = todayISO();
  const day = app.state.dayISO ?? today;
  const isToday = day === today;
  const rows = app.store.byDate(day);
  const { income, expense } = summarize(rows);
  // วันอื่นไม่ต้องเติมวันที่ต่อท้าย เพราะหัวข้อด้านบนบอกวันไว้แล้ว
  // (เติมแล้วป้ายยาวจนตัดบรรทัดบนจอ 390pt)
  const suffix = isToday ? ' วันนี้' : '';

  return el('div', { class: 'screen screen-day' },
    el('header', { class: 'day-page-head' },
      el('p', { class: 'home-date' }, longDate(day)),
      isToday
        ? null
        : el('button', {
            class: 'chip chip-on', type: 'button',
            onclick: () => { app.state.dayISO = today; app.render(); },
          }, 'กลับไปวันนี้'),
      el('div', { class: 'today-totals' },
        totalCard(`รายรับ${suffix}`, income, 'income'),
        totalCard(`รายจ่าย${suffix}`, expense, 'expense'),
      ),
    ),
    app.backupBanner(),
    weekCard(app, day),
    el('main', { class: 'home-list' },
      rows.length === 0
        ? emptyState(isToday)
        : el('ul', { class: 'tx-list' }, rows.map((tx) => transactionRow(app, tx, { compact: true }))),
    ),
  );
}

/** กราฟรายรับ vs รายจ่ายของสัปดาห์นี้ เริ่มวันจันทร์ */
function weekCard(app, day) {
  const days = weekDays(day);
  const today = todayISO();

  const items = days.map((date) => {
    const { income, expense } = summarize(app.store.byDate(date));
    return {
      key: date,
      label: weekdayShort(date),
      income,
      expense,
      day: Number(date.slice(8, 10)),
    };
  });

  const totals = items.reduce(
    (acc, d) => ({ income: acc.income + d.income, expense: acc.expense + d.expense }),
    { income: 0, expense: 0 },
  );
  const logged = items.filter((d) => d.key <= today && (d.income > 0 || d.expense > 0)).length;
  const elapsed = items.filter((d) => d.key <= today).length;

  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-title' }, 'สัปดาห์นี้'),
      el('span', { class: 'week-range' }, weekRangeLabel(day)),
    ),
    groupedBarChart(items, {
      highlight: day,
      onSelect: (item) => { app.state.dayISO = item.key; app.render(); },
    }),
    el('div', { class: 'week-summary' },
      el('span', {}, `รายรับ ${formatMoney(totals.income)}`),
      el('span', {}, `รายจ่าย ${formatMoney(totals.expense)}`),
    ),
    elapsed > 0 && logged < elapsed
      ? el('p', { class: 'hint' }, `บันทึกไปแล้ว ${logged} จาก ${elapsed} วันที่ผ่านมา`)
      : null,
    el('p', { class: 'hint' }, 'แตะแท่งของวันไหนเพื่อดูรายการของวันนั้น'),
  );
}

function totalCard(label, value, kind) {
  return el('div', { class: `total-card total-${kind}` },
    el('span', { class: 'total-label' }, label),
    el('strong', { class: 'total-value' }, formatMoney(value)),
  );
}

function emptyState(isToday) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-mark', 'aria-hidden': 'true' }, '☀'),
    el('p', { class: 'empty-title' }, isToday ? 'วันนี้ยังไม่มีรายการ' : 'วันนี้ไม่มีรายการที่บันทึกไว้'),
    el('p', { class: 'empty-hint' }, 'กดปุ่ม จ่าย หรือ รับ ด้านล่างเพื่อเริ่มบันทึก'),
    el('p', { class: 'empty-hint' }, 'พิมพ์สั้น ๆ ได้เลย เช่น “ก๋วยเตี๋ยว 20 บาท อาหาร”'),
  );
}

/** แถวรายการหนึ่งรายการ — แตะเพื่อแก้ไขหรือลบ */
/**
 * แถวรายการหนึ่งรายการ
 * @param {object} options
 * @param {boolean} options.showDate     แสดงวันที่ในบรรทัดรอง
 * @param {boolean} options.compact      แถวเตี้ยลง เพื่อให้เห็นรายการได้มากขึ้น
 * @param {boolean} options.selectable   อยู่ในโหมดเลือกหลายรายการ
 * @param {boolean} options.selected     ถูกเลือกอยู่หรือไม่
 * @param {Function} options.onToggle    เรียกเมื่อแตะในโหมดเลือก
 */
export function transactionRow(app, tx, {
  showDate = false, compact = false, selectable = false, selected = false, onToggle = null,
} = {}) {
  const isIncome = tx.kind === 'income';
  const sign = isIncome ? '+' : '−';

  const classes = ['tx-row', `tx-${isIncome ? 'income' : 'expense'}`];
  if (compact) classes.push('tx-row-compact');
  if (selectable && selected) classes.push('tx-row-selected');

  return el('li', { class: classes.join(' ') },
    el('button', {
      class: 'tx-button', type: 'button',
      // ในโหมดเลือก การแตะคือการติ๊ก ไม่ใช่การเปิดหน้าแก้ไข
      'aria-pressed': selectable ? String(selected) : null,
      onclick: () => (selectable ? onToggle?.(tx) : openRowActions(app, tx)),
    },
      selectable
        ? el('span', {
            class: `tx-check ${selected ? 'tx-check-on' : ''}`, 'aria-hidden': 'true',
          }, selected ? '✓' : '')
        : null,
      el('span', { class: 'tx-main' },
        el('span', { class: 'tx-name' }, tx.name),
        el('span', { class: 'tx-meta' },
          el('span', { class: 'tx-kind-tag' }, isIncome ? 'รับ' : 'จ่าย'),
          tx.type
            ? el('span', { class: 'tx-type' }, tx.type)
            : el('span', { class: 'tx-type tx-type-none' }, groupLabel(tx.group)),
          showDate ? el('span', { class: 'tx-date' }, tx.date) : null,
        ),
      ),
      tx.amount === null
        ? el('span', { class: 'tx-amount tx-amount-missing' }, 'ยังไม่ระบุมูลค่า')
        : el('span', { class: 'tx-amount' }, `${sign}${formatMoney(tx.amount)}`),
    ),
  );
}

function openRowActions(app, tx) {
  app.openLog({ mode: 'edit', transaction: tx });
}

export async function deleteTransaction(app, tx) {
  const ok = await confirmDialog({
    title: 'ลบรายการนี้?',
    message: `“${tx.name}” จะถูกลบออกจากบันทึก`,
    confirmText: 'ลบ',
    danger: true,
  });
  if (!ok) return false;
  await app.store.remove(tx.id);
  toast('ลบรายการแล้ว');
  return true;
}
