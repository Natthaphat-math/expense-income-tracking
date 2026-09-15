// หน้าเดือน — กราฟ ยอดรวม รายการรายวัน และงบเทียบใช้จริง

import { el, replace } from '../dom.js';
import {
  formatMoney, formatNumber, monthTitle, shiftMonthKey, longDate,
  daysInMonth, parseMonthKey, monthKey as makeMonthKey, todayISO, monthName,
} from '../format.js';
import {
  summarize, sumByType, groupLabel, budgetFor, activeCategories,
  BUDGET_GROUPS, targetWord, groupForCategory, groupKind, GROUPS,
} from '../model.js';
import { donutChart, lineChart, progressBar } from '../charts.js';
import { openMonthPicker, openPicker, promptNumber, openSheet, toast, confirmDialog } from '../ui.js';
import { transactionRow } from './home.js';

const BREAKDOWN_TABS = [
  { id: 'expense', label: 'รายจ่าย', groups: ['DE', 'SD', 'IV'] },
  { id: 'income', label: 'รายรับ', groups: ['IN'] },
  { id: 'savings', label: 'การออม', groups: ['SV'] },
];

export function renderMonth(app, options = {}) {
  const state = {
    key: options.monthKey ?? app.state.monthKey,
    tab: 'expense',
    filterType: null,
    open: app.state.monthSections ?? new Set(['budget']),
    selecting: false,
    selected: new Set(),
    openGaps: new Set(),
  };

  const host = el('div', { class: 'screen screen-month' });

  const rerender = () => {
    app.state.monthKey = state.key;
    app.state.monthSections = state.open;
    replace(host, build());
  };

  function build() {
    const summary = app.store.monthSummary(state.key);
    // ต้องเทียบกับ null ตรง ๆ — ตัวกรอง "ไม่ระบุประเภท" มีค่าเป็น '' ซึ่งเป็น falsy
    const rows = state.filterType !== null
      ? summary.rows.filter((t) => (t.type ?? '') === state.filterType)
      : summary.rows;

    return [
      header(),
      el('div', { class: 'month-body' },
        el('div', { class: 'col col-primary' },
          breakdownCard(summary),
          totalsCard(summary),
          budgetSection(summary),
          incomeSection(summary),
          savingsSection(summary),
          balanceSection(summary),
        ),
        el('div', { class: 'col col-secondary' },
          listCard(summary, rows),
        ),
      ),
    ];
  }

  function header() {
    return el('header', { class: 'page-head' },
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'ปิด', onclick: () => app.back() }, '✕'),
      el('div', { class: 'page-head-center' },
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'เดือนก่อนหน้า',
          onclick: () => { state.key = shiftMonthKey(state.key, -1); resetSelection(); rerender(); },
        }, '‹'),
        el('button', {
          class: 'page-title-button', type: 'button',
          onclick: () => openMonthPicker({
            value: state.key,
            onSelect: (key) => { state.key = key; resetSelection(); rerender(); },
          }),
        }, monthTitle(state.key)),
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': 'เดือนถัดไป',
          onclick: () => { state.key = shiftMonthKey(state.key, 1); resetSelection(); rerender(); },
        }, '›'),
      ),
      el('span', { class: 'btn-icon-placeholder' }),
    );
  }

  function breakdownCard(summary) {
    const tab = BREAKDOWN_TABS.find((t) => t.id === state.tab);
    const rows = summary.rows.filter((t) => tab.groups.includes(t.group));
    const data = sumByType(rows);

    return el('section', { class: 'card' },
      el('div', { class: 'seg seg-full' }, BREAKDOWN_TABS.map((t) => el('button', {
        class: `seg-item ${t.id === state.tab ? 'seg-item-on' : ''}`, type: 'button',
        onclick: () => { state.tab = t.id; rerender(); },
      }, t.label))),
      donutChart(data, {
        title: `สัดส่วน${tab.label}ตามประเภท`,
        centerLabel: 'บาท',
        onSlice: (row) => {
          state.filterType = row.name === 'ไม่ระบุประเภท' ? '' : row.name;
          rerender();
        },
      }),
    );
  }

  function totalsCard(summary) {
    return el('section', { class: 'card totals-card' },
      el('div', { class: 'totals-grid' },
        totalLine('รายรับ', summary.income, 'income'),
        totalLine('รายจ่าย*', summary.expense, 'expense'),
        el('button', {
          class: 'total-line total-editable', type: 'button',
          onclick: () => editOpening(summary),
        },
          el('span', { class: 'total-label' }, 'ยอดเริ่มต้น'),
          el('span', { class: 'total-value' }, formatMoney(summary.opening)),
          el('span', { class: 'total-edit-mark', 'aria-hidden': 'true' }, '✎'),
        ),
        totalLine('ยอดคงเหลือ', summary.remaining, summary.remaining < 0 ? 'negative' : 'balance'),
      ),
      el('p', { class: 'footnote' }, '*รวมการออมเงิน'),
      summary.hasExplicitOpening
        ? null
        : el('p', { class: 'footnote' }, 'ยอดเริ่มต้นยกมาจากเดือนก่อนให้อัตโนมัติ'),
    );
  }

  function totalLine(label, value, tone) {
    return el('div', { class: `total-line total-${tone}` },
      el('span', { class: 'total-label' }, label),
      el('span', { class: 'total-value' }, formatMoney(value)),
    );
  }

  async function editOpening(summary) {
    const handle = openSheet({
      title: 'ยอดเริ่มต้นของเดือนนี้',
      body: el('div', { class: 'form' },
        el('p', { class: 'field-hint' }, `${monthTitle(state.key)} — ยอดเงินที่มีอยู่ก่อนเริ่มเดือน`),
        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            const value = await promptNumber({
              title: 'ระบุยอดเริ่มต้น',
              label: 'ยอดเริ่มต้น (บาท)',
              value: summary.opening,
            });
            if (value === undefined) return;
            await app.store.setOpeningBalance(state.key, value ?? 0);
            rerender();
          },
        }, 'ระบุยอดเริ่มต้นเอง'),
        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            await app.store.setOpeningBalance(state.key, null);
            toast('ยกยอดคงเหลือจากเดือนก่อนแล้ว');
            rerender();
          },
        }, 'ยกยอดคงเหลือจากเดือนก่อน'),
      ),
    });
  }

  /** ส่วนที่พับเก็บได้ */
  function collapsible(id, title, subtitle, buildBody) {
    const isOpen = state.open.has(id);
    return el('section', { class: 'card card-collapsible' },
      el('button', {
        class: 'collapse-head', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false',
        onclick: () => {
          if (isOpen) state.open.delete(id);
          else state.open.add(id);
          rerender();
        },
      },
        el('span', { class: 'collapse-title' },
          el('strong', {}, title),
          subtitle ? el('span', { class: 'collapse-sub' }, subtitle) : null,
        ),
        el('span', { class: `collapse-mark ${isOpen ? 'collapse-mark-open' : ''}`, 'aria-hidden': 'true' }, '⌄'),
      ),
      isOpen ? el('div', { class: 'collapse-body' }, buildBody()) : null,
    );
  }

  function budgetSection(summary) {
    const actualByGroup = summary.byGroup;
    const totalBudget = BUDGET_GROUPS.reduce((sum, g) => sum + groupBudget(g), 0);
    const totalActual = BUDGET_GROUPS.reduce((sum, g) => sum + actualByGroup[g], 0);

    return collapsible('budget', 'งบประมาณ vs ใช้จริง',
      `${formatNumber(totalActual)} / ${formatNumber(totalBudget)} บาท`,
      () => BUDGET_GROUPS.map((code) => groupBlock(code, actualByGroup[code], summary)));
  }

  function groupBudget(code) {
    return activeCategories(app.store.settings, { group: code })
      .reduce((sum, c) => sum + budgetFor(app.store.settings, state.key, c.name), 0);
  }

  function groupBlock(code, actual, summary) {
    const budget = groupBudget(code);
    const diff = budget - actual;

    return el('div', { class: 'budget-group' },
      el('div', { class: 'budget-group-head' },
        el('strong', {}, groupLabel(code)),
        el('span', { class: 'budget-group-numbers' }, `${formatNumber(actual)} / ${formatNumber(budget)}`),
      ),
      progressBar(actual, budget),
      el('p', { class: `budget-remain ${diff < 0 ? 'budget-over' : ''}` },
        budget === 0
          ? 'ยังไม่ได้ตั้งงบสำหรับกลุ่มนี้'
          : diff >= 0
            ? `เหลือให้ใช้อีก ${formatMoney(diff)}`
            : `เกินงบมา ${formatMoney(Math.abs(diff))}`),
      categoryTable(code, summary),
    );
  }

  function categoryTable(code, summary) {
    const cats = activeCategories(app.store.settings, { group: code });
    const actualByType = new Map();
    for (const tx of summary.rows) {
      if (tx.group !== code || !tx.type) continue;
      actualByType.set(tx.type, (actualByType.get(tx.type) ?? 0) + (tx.amount ?? 0));
    }
    const untyped = summary.rows
      .filter((t) => t.group === code && !t.type)
      .reduce((sum, t) => sum + (t.amount ?? 0), 0);

    if (cats.length === 0 && untyped === 0) {
      return el('p', { class: 'hint' }, 'ยังไม่มีประเภทในกลุ่มนี้');
    }

    const word = targetWord(code);
    return el('table', { class: 'budget-table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'ประเภท'),
        el('th', { class: 'num' }, word),
        el('th', { class: 'num' }, 'ใช้จริง'),
        el('th', { class: 'num' }, 'ส่วนต่าง'),
      )),
      el('tbody', {},
        cats.map((c) => {
          const budget = budgetFor(app.store.settings, state.key, c.name);
          const actual = actualByType.get(c.name) ?? 0;
          if (budget === 0 && actual === 0) return null;
          const diff = budget - actual;
          return el('tr', {},
            el('td', {}, el('button', {
              class: 'link-cell', type: 'button',
              onclick: () => editBudget(c.name, budget),
            }, c.name)),
            el('td', { class: 'num' }, formatNumber(budget)),
            el('td', { class: 'num' }, formatNumber(actual)),
            el('td', { class: `num ${diff < 0 ? 'num-over' : ''}` }, formatNumber(diff)),
          );
        }),
        untyped > 0
          ? el('tr', { class: 'row-untyped' },
              el('td', {}, 'ไม่ระบุประเภท'),
              el('td', { class: 'num' }, '—'),
              el('td', { class: 'num' }, formatNumber(untyped)),
              el('td', { class: 'num' }, '—'),
            )
          : null,
      ),
      el('tfoot', {}, el('tr', {}, el('td', { colspan: '4' },
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => pickCategoryToBudget(code),
        }, `ตั้ง${word}ให้ประเภทอื่น`),
      ))),
    );
  }

  function pickCategoryToBudget(code) {
    const cats = activeCategories(app.store.settings, { group: code });
    if (cats.length === 0) {
      toast('ยังไม่มีประเภทในกลุ่มนี้');
      return;
    }
    openPicker({
      title: `เลือกประเภทเพื่อตั้ง${targetWord(code)}`,
      items: cats.map((c) => ({
        label: c.name, value: c.name,
        hint: formatNumber(budgetFor(app.store.settings, state.key, c.name)),
      })),
      onSelect: (name) => editBudget(name, budgetFor(app.store.settings, state.key, name)),
    });
  }

  async function editBudget(name, current) {
    const handle = openSheet({
      title: name,
      body: el('div', { class: 'form' },
        el('p', { class: 'field-hint' }, `ตอนนี้ตั้งไว้ ${formatMoney(current)}`),
        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            const value = await promptNumber({
              title: name, label: 'จำนวน (บาท)', value: current,
              hint: 'ใช้กับทุกเดือนต่อจากนี้',
            });
            if (value === undefined) return;
            await app.store.setBudget(name, value ?? 0, { scope: 'default', monthKey: state.key });
            rerender();
          },
        }, 'ตั้งเป็นค่าเริ่มต้นทุกเดือน'),
        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            const value = await promptNumber({
              title: name, label: 'จำนวน (บาท)', value: current,
              hint: `ใช้เฉพาะ ${monthTitle(state.key)}`,
            });
            if (value === undefined) return;
            await app.store.setBudget(name, value ?? 0, { scope: 'month', monthKey: state.key });
            rerender();
          },
        }, `ใช้เฉพาะ ${monthTitle(state.key)}`),
      ),
    });
  }

  function targetSection(id, title, code, summary) {
    const cats = activeCategories(app.store.settings, { group: code });
    const actualByType = new Map();
    for (const tx of summary.rows) {
      if (tx.group !== code || !tx.type) continue;
      actualByType.set(tx.type, (actualByType.get(tx.type) ?? 0) + (tx.amount ?? 0));
    }
    const actualTotal = summary.byGroup[code];
    const targetTotal = cats.reduce((sum, c) => sum + budgetFor(app.store.settings, state.key, c.name), 0);
    const actualWord = code === 'SV' ? 'ออมได้จริง' : 'จริง';

    return collapsible(id, title, `${formatNumber(actualTotal)} / ${formatNumber(targetTotal)} บาท`, () => [
      progressBar(actualTotal, targetTotal),
      el('p', { class: 'budget-remain' },
        targetTotal === 0
          ? 'ยังไม่ได้ตั้งเป้าหมาย'
          : actualTotal >= targetTotal
            ? `ถึงเป้าแล้ว เกินมา ${formatMoney(actualTotal - targetTotal)}`
            : `ยังขาดอีก ${formatMoney(targetTotal - actualTotal)}`),
      el('table', { class: 'budget-table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'ประเภท'),
          el('th', { class: 'num' }, 'เป้าหมาย'),
          el('th', { class: 'num' }, actualWord),
          el('th', { class: 'num' }, 'ส่วนต่าง'),
        )),
        el('tbody', {}, cats.map((c) => {
          const target = budgetFor(app.store.settings, state.key, c.name);
          const actual = actualByType.get(c.name) ?? 0;
          if (target === 0 && actual === 0) return null;
          const diff = actual - target;
          return el('tr', {},
            el('td', {}, el('button', {
              class: 'link-cell', type: 'button',
              onclick: () => editBudget(c.name, target),
            }, c.name)),
            el('td', { class: 'num' }, formatNumber(target)),
            el('td', { class: 'num' }, formatNumber(actual)),
            el('td', { class: `num ${diff < 0 ? 'num-over' : ''}` }, formatNumber(diff)),
          );
        })),
      ),
    ]);
  }

  function incomeSection(summary) {
    return targetSection('income', 'รายได้', 'IN', summary);
  }

  function savingsSection(summary) {
    return targetSection('savings', 'การออม', 'SV', summary);
  }

  function balanceSection(summary) {
    return collapsible('balance', 'ยอดคงเหลือรายวัน', '', () => {
      const days = daysInMonth(state.key);
      const perDay = new Map();
      for (const tx of summary.rows) {
        const day = Number(tx.date.slice(8, 10));
        const delta = (tx.kind === 'income' ? 1 : -1) * (tx.amount ?? 0);
        const row = perDay.get(day) ?? { delta: 0, count: 0 };
        row.delta += delta;
        row.count += 1;
        perDay.set(day, row);
      }
      let running = summary.opening;
      const points = [];
      for (let d = 1; d <= days; d += 1) {
        const row = perDay.get(d);
        running += row?.delta ?? 0;
        points.push({ day: d, balance: Math.round(running * 100) / 100, hasActivity: Boolean(row) });
      }
      return lineChart(points);
    });
  }

  function listCard(summary, rows) {
    const byDay = new Map();
    for (const tx of rows) {
      if (!byDay.has(tx.date)) byDay.set(tx.date, []);
      byDay.get(tx.date).push(tx);
    }

    const days = listDays(byDay);
    const selectableIds = rows.map((t) => t.id);

    return el('section', { class: 'card card-list' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, 'รายการเดือนนี้'),
        el('div', { class: 'list-tools' },
          el('button', {
            class: `chip ${state.filterType !== null ? 'chip-on' : ''}`, type: 'button',
            onclick: () => openTypeFilter(summary),
          }, state.filterType === null
            ? 'ทั้งหมด'
            : state.filterType === '' ? 'ไม่ระบุประเภท' : state.filterType),
          rows.length > 0
            ? el('button', {
                class: `chip ${state.selecting ? 'chip-on' : ''}`, type: 'button',
                onclick: () => {
                  state.selecting = !state.selecting;
                  state.selected.clear();
                  rerender();
                },
              }, state.selecting ? 'เสร็จสิ้น' : 'เลือก')
            : null,
        ),
      ),

      days.length === 0
        ? el('p', { class: 'hint' }, 'ยังไม่มีรายการในเดือนนี้')
        : el('div', { class: 'day-groups' }, groupRuns(days, byDay).map((block) => {
            if (block.kind === 'day') return dayGroup(block.date, block.items);
            if (block.dates.length < 3 || state.openGaps.has(block.id)) {
              return block.dates.map((d) => emptyDay(d));
            }
            return emptyRun(block);
          })),

      state.selecting ? selectionBar(selectableIds) : null,
    );
  }

  function dayGroup(date, items) {
    const totals = summarize(items);
    const allPicked = state.selecting && items.every((t) => state.selected.has(t.id));

    return el('section', { class: 'day-group' },
      el('div', { class: 'day-head' },
        state.selecting
          ? el('button', {
              class: `day-pick ${allPicked ? 'day-pick-on' : ''}`, type: 'button',
              onclick: () => {
                // แตะหัววันเพื่อเลือกหรือยกเลิกทั้งวันในครั้งเดียว
                for (const t of items) {
                  if (allPicked) state.selected.delete(t.id);
                  else state.selected.add(t.id);
                }
                rerender();
              },
            }, `${allPicked ? '✓ ' : ''}${longDate(date)}`)
          : el('span', { class: 'day-name' }, longDate(date)),
        el('span', { class: 'day-total' },
          totals.income > 0 ? el('span', { class: 'day-in' }, `+${formatNumber(totals.income)}`) : null,
          totals.expense > 0 ? el('span', { class: 'day-out' }, `−${formatNumber(totals.expense)}`) : null,
        ),
      ),
      el('ul', { class: 'tx-list' }, items.map((tx) => transactionRow(app, tx, {
        compact: true,
        selectable: state.selecting,
        selected: state.selected.has(tx.id),
        onToggle: (t) => {
          if (state.selected.has(t.id)) state.selected.delete(t.id);
          else state.selected.add(t.id);
          rerender();
        },
      }))),
    );
  }

  /**
   * วันที่ยังไม่มีรายการ — เตือนเบา ๆ ว่าอาจลืมบันทึก
   * ทั้งแถวเป็นปุ่มเดียว เพื่อให้พื้นที่แตะถึงเกณฑ์ 44pt โดยไม่ต้องมีชิปเล็ก ๆ
   */
  function emptyDay(date) {
    return el('section', { class: 'day-group day-group-empty' },
      el('button', {
        class: 'day-empty-row', type: 'button',
        onclick: () => app.openLog({ kind: 'expense', date }),
      },
        el('span', { class: 'day-name day-name-empty' }, longDate(date)),
        el('span', { class: 'day-empty-hint' }, 'ยังไม่ได้บันทึก +'),
      ),
    );
  }

  /** รวมวันว่างที่อยู่ติดกันเป็นก้อนเดียว เพื่อไม่ให้บังรายการจริง */
  function groupRuns(days, byDay) {
    const blocks = [];
    let run = null;
    for (const date of days) {
      const items = byDay.get(date);
      if (items) {
        run = null;
        blocks.push({ kind: 'day', date, items });
      } else {
        if (!run) {
          run = { kind: 'gap', id: date, dates: [] };
          blocks.push(run);
        }
        run.dates.push(date);
      }
    }
    return blocks;
  }

  /** แถวเดียวแทนวันว่างหลายวันติดกัน แตะเพื่อกางดูทีละวัน */
  function emptyRun(block) {
    const dates = block.dates;
    // รายการเรียงจากใหม่ไปเก่า แต่อ่านช่วงวันจากน้อยไปมากเป็นธรรมชาติกว่า
    const first = dates[dates.length - 1];
    const last = dates[0];
    const { month } = parseMonthKey(state.key);
    const range = `${Number(first.slice(8, 10))} – ${Number(last.slice(8, 10))} ${monthName(month)}`;

    return el('section', { class: 'day-group day-group-empty' },
      el('button', {
        class: 'day-empty-row day-empty-run', type: 'button',
        onclick: () => { state.openGaps.add(block.id); rerender(); },
      },
        el('span', { class: 'day-name day-name-empty' }, range),
        el('span', { class: 'day-empty-hint' },
          `ยังไม่ได้บันทึก ${formatNumber(dates.length)} วัน`),
      ),
    );
  }

  /**
   * วันที่จะแสดงในรายการ เรียงจากใหม่ไปเก่า
   *
   * รวมวันที่ยังไม่มีรายการเข้าไปด้วย เพื่อให้เห็นว่าลืมบันทึกวันไหน แต่จะไม่ทำ
   * เมื่อกรองประเภทอยู่ (วันที่ไม่เข้าเงื่อนไขไม่ได้แปลว่าลืมบันทึก) และไม่ทำ
   * กับเดือนที่ไม่เคยมีข้อมูลเลย (ไม่งั้นเปิดเดือนไหนก็เจอแต่คำเตือน)
   * เดือนปัจจุบันแสดงถึงวันนี้เท่านั้น ไม่ใช่ทั้งเดือน
   */
  function listDays(byDay) {
    const withData = [...byDay.keys()];
    if (state.filterType !== null) {
      return withData.sort((a, b) => b.localeCompare(a));
    }

    const today = todayISO();
    const thisMonth = today.slice(0, 7);
    const isPast = state.key < thisMonth;
    const isCurrent = state.key === thisMonth;
    if (withData.length === 0 && !isCurrent) return [];
    if (!isPast && !isCurrent) {
      // เดือนในอนาคต — ไม่มีอะไรให้ลืม
      return withData.sort((a, b) => b.localeCompare(a));
    }

    const last = isCurrent ? Number(today.slice(8, 10)) : daysInMonth(state.key);
    const all = [];
    for (let d = last; d >= 1; d -= 1) {
      all.push(`${state.key}-${String(d).padStart(2, '0')}`);
    }
    // รายการที่ลงวันที่ล่วงหน้าไว้ ยังต้องแสดงด้วย
    for (const date of withData) {
      if (!all.includes(date)) all.push(date);
    }
    return all.sort((a, b) => b.localeCompare(a));
  }

  /** แถบล่างตอนเลือกหลายรายการ */
  function selectionBar(visibleIds) {
    const count = state.selected.size;
    const allPicked = visibleIds.length > 0 && visibleIds.every((id) => state.selected.has(id));

    return el('div', { class: 'select-bar' },
      el('button', {
        class: 'btn btn-small', type: 'button',
        onclick: () => {
          if (allPicked) state.selected.clear();
          else for (const id of visibleIds) state.selected.add(id);
          rerender();
        },
      }, allPicked ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด'),
      el('span', { class: 'select-count' },
        count === 0 ? 'ยังไม่ได้เลือก' : `เลือกแล้ว ${formatNumber(count)} รายการ`),
      el('button', {
        class: 'btn btn-small btn-primary', type: 'button',
        disabled: count === 0 ? true : null,
        onclick: () => openBatchType(),
      }, 'เปลี่ยนประเภท'),
    );
  }

  /** เลือกประเภทแล้วนำไปใช้กับทุกรายการที่ติ๊กไว้ */
  function openBatchType() {
    const picked = app.store.active.filter((t) => state.selected.has(t.id));
    if (picked.length === 0) return;

    const cats = activeCategories(app.store.settings);
    openPicker({
      title: `เปลี่ยนประเภท ${formatNumber(picked.length)} รายการ`,
      items: cats.map((c) => ({ label: c.name, value: c.name, group: c.group, aliases: c.aliases })),
      searchPlaceholder: 'ค้นหาประเภท',
      groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
      onSelect: (name) => applyBatchType(picked, name),
    });
  }

  async function applyBatchType(picked, name) {
    const group = groupForCategory(app.store.settings, name, 'expense');
    const kind = groupKind(group);

    // การย้ายประเภทข้ามฝั่งจะพลิกรายรับเป็นรายจ่าย (หรือกลับกัน) ต้องบอกให้ชัด
    const flipping = picked.filter((t) => t.kind !== kind);
    const lines = [`ตั้งประเภทเป็น “${name}” (${groupLabel(group)})`];
    if (flipping.length > 0) {
      lines.push(
        `\nในจำนวนนี้มี ${formatNumber(flipping.length)} รายการที่จะเปลี่ยนจาก` +
        `${kind === 'income' ? 'รายจ่ายเป็นรายรับ' : 'รายรับเป็นรายจ่าย'}ด้วย`,
      );
    }

    const ok = await confirmDialog({
      title: `เปลี่ยน ${formatNumber(picked.length)} รายการ?`,
      message: lines.join('\n'),
      confirmText: 'เปลี่ยนเลย',
      danger: flipping.length > 0,
    });
    if (!ok) return;

    await app.store.saveMany(picked.map((t) => ({ ...t, type: name, group, kind })));
    state.selected.clear();
    state.selecting = false;
    toast(`เปลี่ยนประเภทแล้ว ${formatNumber(picked.length)} รายการ`);
    rerender();
  }

  function openTypeFilter(summary) {
    const names = [...new Set(summary.rows.map((t) => t.type ?? ''))].sort();
    openPicker({
      title: 'เลือกประเภทค่าใช้จ่าย',
      items: [
        { label: 'ทั้งหมด', value: '__all__' },
        ...names.map((n) => ({ label: n === '' ? 'ไม่ระบุประเภท' : n, value: n })),
      ],
      selected: state.filterType === null ? '__all__' : state.filterType,
      onSelect: (value) => {
        state.filterType = value === '__all__' ? null : value;
        state.selected.clear();
        rerender();
      },
    });
  }

  function resetSelection() {
    state.filterType = null;
    state.selecting = false;
    state.selected.clear();
    state.openGaps.clear();
  }

  rerender();
  return host;
}
