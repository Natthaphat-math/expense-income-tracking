// หน้าหลัก — รายการของวันนี้ และยอดรวมวันนี้

import { el, replace } from '../dom.js';
import { formatMoney, longDate, todayISO } from '../format.js';
import { summarize, groupLabel } from '../model.js';
import { confirmDialog, toast } from '../ui.js';

export function renderHome(app) {
  const today = todayISO();
  const rows = app.store.byDate(today);
  const { income, expense } = summarize(rows);

  return el('div', { class: 'screen screen-home' },
    el('header', { class: 'home-head' },
      el('div', { class: 'home-head-row' },
        el('p', { class: 'home-date' }, longDate(today)),
        el('button', {
          class: 'btn-icon btn-settings', type: 'button', 'aria-label': 'ตั้งค่า',
          onclick: () => app.go('settings'),
        }, '⚙'),
      ),
      el('div', { class: 'today-totals' },
        totalCard('รายรับ วันนี้', income, 'income'),
        totalCard('รายจ่าย วันนี้', expense, 'expense'),
      ),
    ),
    app.backupBanner(),
    el('main', { class: 'home-list' },
      rows.length === 0
        ? emptyState()
        : el('ul', { class: 'tx-list' }, rows.map((tx) => transactionRow(app, tx))),
    ),
  );
}

function totalCard(label, value, kind) {
  return el('div', { class: `total-card total-${kind}` },
    el('span', { class: 'total-label' }, label),
    el('strong', { class: 'total-value' }, formatMoney(value)),
  );
}

function emptyState() {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-mark', 'aria-hidden': 'true' }, '☀'),
    el('p', { class: 'empty-title' }, 'วันนี้ยังไม่มีรายการ'),
    el('p', { class: 'empty-hint' }, 'กดปุ่ม จ่าย หรือ รับ ด้านล่างเพื่อเริ่มบันทึก'),
    el('p', { class: 'empty-hint' }, 'พิมพ์สั้น ๆ ได้เลย เช่น “ก๋วยเตี๋ยว 20 บาท อาหาร”'),
  );
}

/** แถวรายการหนึ่งรายการ — แตะเพื่อแก้ไขหรือลบ */
export function transactionRow(app, tx, { showDate = false } = {}) {
  const isIncome = tx.kind === 'income';
  const sign = isIncome ? '+' : '−';

  return el('li', { class: `tx-row tx-${isIncome ? 'income' : 'expense'}` },
    el('button', {
      class: 'tx-button', type: 'button',
      onclick: () => openRowActions(app, tx),
    },
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
