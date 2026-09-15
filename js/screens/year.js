// หน้าปี — ภาพรวมทั้งปี เทียบรายเดือน และความคืบหน้าเทียบเป้าหมาย

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, monthName, monthNameShort, monthTitle, monthKey } from '../format.js';
import {
  sumByType, budgetFor, activeCategories, BUDGET_GROUPS, groupLabel,
} from '../model.js';
import { groupedBarChart, donutChart, progressBar } from '../charts.js';
import { openPicker } from '../ui.js';

const BREAKDOWN_TABS = [
  { id: 'expense', label: 'รายจ่าย', groups: ['DE', 'SD', 'IV'] },
  { id: 'income', label: 'รายรับ', groups: ['IN'] },
  { id: 'savings', label: 'การออม', groups: ['SV'] },
];

export function renderYear(app, options = {}) {
  const state = {
    // ปีที่ดูอยู่เก็บที่ app.state เพราะปุ่มเปลี่ยนปีย้ายไปอยู่แถบล่างแล้ว
    year: options.year ?? app.state.year,
    selectedMonth: options.month ?? new Date().getMonth() + 1,
    tab: app.state.yearTab ?? 'expense',
  };

  const host = el('div', { class: 'screen screen-year' });

  const rerender = () => {
    app.state.year = state.year;
    app.state.yearTab = state.tab;
    replace(host, build());
  };

  function build() {
    const summary = app.store.yearSummary(state.year);
    return [
      el('div', { class: 'year-body' },
        el('div', { class: 'col col-primary' },
          summaryCards(summary),
          chartCard(summary),
        ),
        el('div', { class: 'col col-secondary' },
          progressCard(summary),
          monthBreakdown(),
        ),
      ),
    ];
  }

  function summaryCards(summary) {
    return el('section', { class: 'summary-cards' },
      summaryCard('ยอดคงเหลือ', summary.remaining, summary.remaining < 0 ? 'negative' : 'balance'),
      summaryCard('รายได้ทั้งปี', summary.income, 'income'),
      summaryCard('รายจ่ายทั้งปี*', summary.expense, 'expense'),
      el('p', { class: 'footnote footnote-wide' }, '*รวมการออมเงิน'),
    );
  }

  function summaryCard(label, value, tone) {
    return el('div', { class: `summary-card summary-${tone}` },
      el('span', { class: 'summary-label' }, label),
      el('strong', { class: 'summary-value' }, formatMoney(value)),
    );
  }

  function chartCard(summary) {
    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'รายรับ vs รายจ่าย รายเดือน'),
      groupedBarChart(summary.months.map((m) => ({
        key: m.key,
        label: monthNameShort(m.month),
        income: m.income,
        expense: m.expense,
      })), {
        highlight: monthKey(state.year, state.selectedMonth),
        onSelect: (m) => app.go('month', { monthKey: m.key }),
      }),
      el('p', { class: 'hint' }, 'แตะแท่งของเดือนไหนเพื่อเปิดหน้าเดือนนั้น'),
    );
  }

  function progressCard(summary) {
    const settings = app.store.settings;
    const months = Array.from({ length: 12 }, (_, i) => monthKey(state.year, i + 1));

    /** เป้าหมายทั้งปี = ผลรวมของงบรายเดือนทั้ง 12 เดือน (นับ override รายเดือนด้วย) */
    const yearTarget = (groups) => {
      let total = 0;
      for (const key of months) {
        for (const code of groups) {
          for (const c of activeCategories(settings, { group: code })) {
            total += budgetFor(settings, key, c.name);
          }
        }
      }
      return total;
    };

    const incomeTarget = yearTarget(['IN']);
    const expenseTarget = yearTarget(BUDGET_GROUPS);
    const savingsTarget = yearTarget(['SV']);
    const expenseActual = BUDGET_GROUPS.reduce((sum, g) => sum + summary.byGroup[g], 0);

    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'ความคืบหน้าทั้งปี'),
      progressRow('รายได้', summary.income, incomeTarget, 'เป้าหมาย', true),
      progressRow('รายจ่าย', expenseActual, expenseTarget, 'งบ', false),
      progressRow('การออม', summary.savings, savingsTarget, 'เป้าหมาย', true),
    );
  }

  /** higherIsBetter: รายได้/การออมยิ่งมากยิ่งดี ส่วนรายจ่ายยิ่งน้อยยิ่งดี */
  function progressRow(label, actual, target, word, higherIsBetter) {
    const diff = higherIsBetter ? actual - target : target - actual;
    return el('div', { class: 'progress-row' },
      el('div', { class: 'progress-row-head' },
        el('strong', {}, label),
        el('span', { class: 'progress-row-numbers' },
          `${formatNumber(actual)} / ${formatNumber(target)}`),
      ),
      progressBar(actual, target),
      el('p', { class: `budget-remain ${diff < 0 ? 'budget-over' : ''}` },
        target === 0
          ? `ยังไม่ได้ตั้ง${word}`
          : diff >= 0
            ? `ส่วนต่าง +${formatMoney(diff)}`
            : `ส่วนต่าง −${formatMoney(Math.abs(diff))}`),
    );
  }

  function monthBreakdown() {
    const key = monthKey(state.year, state.selectedMonth);
    const rows = app.store.byMonth(key);
    const tab = BREAKDOWN_TABS.find((t) => t.id === state.tab);
    const data = sumByType(rows.filter((t) => tab.groups.includes(t.group)));

    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, 'ดูรายเดือน'),
        el('button', {
          class: 'chip chip-on', type: 'button',
          onclick: () => openPicker({
            title: 'เลือกเดือน',
            items: Array.from({ length: 12 }, (_, i) => ({ label: monthName(i + 1), value: i + 1 })),
            selected: state.selectedMonth,
            onSelect: (m) => { state.selectedMonth = m; rerender(); },
          }),
        }, monthName(state.selectedMonth)),
      ),
      el('div', { class: 'seg seg-full' }, BREAKDOWN_TABS.map((t) => el('button', {
        class: `seg-item ${t.id === state.tab ? 'seg-item-on' : ''}`, type: 'button',
        onclick: () => { state.tab = t.id; rerender(); },
      }, t.label))),
      donutChart(data, { title: `สัดส่วน${tab.label}`, centerLabel: 'บาท' }),
      el('button', {
        class: 'btn btn-block', type: 'button',
        onclick: () => app.go('month', { monthKey: key }),
      }, `เปิดหน้า ${monthTitle(key)}`),
    );
  }

  rerender();
  return host;
}
