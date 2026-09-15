// หน้าตั้งค่า — จัดการประเภท, งบเริ่มต้น, สำรองข้อมูล และนำเข้า

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, todayISO, shortDate } from '../format.js';
import {
  GROUPS, groupLabel, groupsForKind, budgetFor, targetWord, groupKind,
} from '../model.js';
import {
  openSheet, openPicker, confirmDialog, promptText, promptNumber, toast,
} from '../ui.js';
import {
  buildBackup, backupFilename, parseBackupFile, mergeTransactions, mergeCategories,
} from '../backup.js';
import { addCategoryFlow } from './log.js';

export function renderSettings(app) {
  const host = el('div', { class: 'screen screen-settings' });
  const rerender = () => replace(host, build());

  function build() {
    return [
      el('header', { class: 'page-head' },
        el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'ปิด', onclick: () => app.back() }, '‹'),
        el('span', { class: 'page-title' }, 'ตั้งค่า'),
        el('span', { class: 'btn-icon-placeholder' }),
      ),
      el('div', { class: 'settings-body' },
        el('div', { class: 'col col-primary' }, backupCard(), importCard()),
        el('div', { class: 'col col-secondary' }, categoriesCard(), budgetsCard(), helpCard()),
      ),
    ];
  }

  // ------------------------------------------------------------- สำรองข้อมูล
  function backupCard() {
    const last = app.store.settings.lastBackupAt;
    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'สำรองข้อมูล'),
      el('p', { class: 'field-hint' },
        last ? `สำรองครั้งล่าสุด ${shortDate(String(last).slice(0, 10))}` : 'ยังไม่เคยสำรองข้อมูล'),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: exportData },
        'ส่งออกไฟล์สำรอง'),
      el('p', { class: 'field-hint' },
        'ไฟล์ที่ได้เป็น JSON เก็บไว้ในไฟล์ของฉัน หรือส่งเข้าแชตตัวเองก็ได้'),
    );
  }

  async function exportData() {
    const payload = buildBackup(app.store.transactions, app.store.settings);
    const text = JSON.stringify(payload, null, 1);
    const filename = backupFilename(todayISO());

    try {
      const file = new File([text], filename, { type: 'application/json' });
      // iOS: แชร์ชีตให้เลือกเซฟลงไฟล์ของฉันได้เลย
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        await markBackedUp();
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.warn('แชร์ไฟล์ไม่สำเร็จ ใช้วิธีดาวน์โหลดแทน', err);
    }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await markBackedUp();
  }

  async function markBackedUp() {
    await app.store.updateSettings({ lastBackupAt: new Date().toISOString() });
    toast('สำรองข้อมูลแล้ว');
    rerender();
  }

  // ---------------------------------------------------------------- นำเข้า
  function importCard() {
    const input = el('input', {
      class: 'visually-hidden',
      type: 'file',
      accept: 'application/json,.json',
      onchange: (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) readFile(file);
      },
    });

    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'นำเข้าข้อมูล'),
      el('p', { class: 'field-hint' }, 'เลือกไฟล์ JSON ที่ส่งออกไว้ หรือไฟล์ที่แปลงมาจาก Excel'),
      input,
      el('button', { class: 'btn btn-block', type: 'button', onclick: () => input.click() },
        'เลือกไฟล์ JSON'),
    );
  }

  async function readFile(file) {
    let result;
    try {
      const text = await file.text();
      result = parseBackupFile(text);
    } catch (err) {
      await confirmDialog({
        title: 'เปิดไฟล์ไม่ได้',
        message: err.message ?? 'ไฟล์นี้อ่านไม่ได้',
        confirmText: 'ตกลง',
        cancelText: 'ปิด',
      });
      return;
    }

    if (!result.ok) {
      await confirmDialog({
        title: 'นำเข้าไม่ได้',
        message: result.errors.join('\n') || 'ไฟล์นี้ใช้ไม่ได้',
        confirmText: 'ตกลง',
        cancelText: 'ปิด',
      });
      return;
    }

    showImportPreview(result);
  }

  function showImportPreview(result) {
    const { transactions, settings, stats, warnings } = result;

    const handle = openSheet({
      title: 'ตรวจสอบก่อนนำเข้า',
      body: el('div', { class: 'form' },
        el('p', { class: 'import-summary' },
          `พบ ${formatNumber(stats.transactions)} รายการ, ${formatNumber(stats.categories)} ประเภท`),
        warnings.length > 0
          ? el('ul', { class: 'warn-list' }, warnings.map((w) => el('li', {}, w)))
          : null,
        el('p', { class: 'field-hint' },
          'รวมข้อมูล: เก็บของเดิมไว้ และเพิ่ม/อัปเดตจากไฟล์ (รายการเดียวกันใช้ฉบับที่ใหม่กว่า)'),
        el('button', {
          class: 'btn btn-primary btn-block', type: 'button',
          onclick: async () => { handle.close(); await doImport(result, 'merge'); },
        }, 'รวมข้อมูล'),
        el('p', { class: 'field-hint' }, 'แทนที่ทั้งหมด: ลบข้อมูลเดิมในเครื่องทิ้งทั้งหมด'),
        el('button', {
          class: 'btn btn-danger btn-block', type: 'button',
          onclick: async () => { handle.close(); await doImport(result, 'replace'); },
        }, 'แทนที่ทั้งหมด'),
      ),
      actions: [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
      ],
    });
  }

  async function doImport(result, mode) {
    const { transactions, settings } = result;

    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: 'แทนที่ข้อมูลทั้งหมด?',
        message: `ข้อมูลเดิมในเครื่อง ${formatNumber(app.store.active.length)} รายการจะถูกลบทิ้ง และแทนที่ด้วย ${formatNumber(transactions.length)} รายการจากไฟล์ การกระทำนี้ย้อนกลับไม่ได้`,
        confirmText: 'แทนที่ทั้งหมด',
        danger: true,
      });
      if (!ok) return;

      const second = await confirmDialog({
        title: 'ยืนยันอีกครั้ง',
        message: 'แนะนำให้ส่งออกไฟล์สำรองของข้อมูลเดิมไว้ก่อน แน่ใจว่าจะแทนที่ทั้งหมดใช่ไหม',
        confirmText: 'แน่ใจ แทนที่เลย',
        danger: true,
      });
      if (!second) return;

      await app.store.replaceTransactions(transactions);
      await app.store.updateSettings({
        categories: settings.categories.length > 0 ? settings.categories : app.store.settings.categories,
        budgets: settings.budgets,
        openingBalances: settings.openingBalances,
      });
      toast(`นำเข้าแล้ว ${formatNumber(transactions.length)} รายการ`);
      rerender();
      return;
    }

    const merged = mergeTransactions(app.store.transactions, transactions);
    await app.store.setTransactions(merged.transactions);

    const cats = mergeCategories(app.store.settings.categories, settings.categories);
    await app.store.updateSettings({
      categories: cats.categories,
      budgets: {
        defaults: { ...settings.budgets.defaults, ...app.store.settings.budgets.defaults },
        months: { ...settings.budgets.months, ...app.store.settings.budgets.months },
      },
      openingBalances: { ...settings.openingBalances, ...app.store.settings.openingBalances },
    });

    toast(`เพิ่ม ${formatNumber(merged.added)} รายการ อัปเดต ${formatNumber(merged.updated)} รายการ`);
    rerender();
  }

  // -------------------------------------------------------------- ประเภท
  function categoriesCard() {
    const cats = app.store.settings.categories;
    const byGroup = new Map(GROUPS.map((g) => [g.code, []]));
    for (const c of cats) byGroup.get(c.group)?.push(c);

    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, 'ประเภท'),
        el('button', {
          class: 'btn btn-small', type: 'button',
          onclick: () => addCategoryFlow(app, 'expense', () => rerender()),
        }, '+ เพิ่ม'),
      ),
      el('p', { class: 'field-hint' }, 'ประเภทใช้ร่วมกันทุกเดือนทุกปี ไม่ต้องกรอกใหม่'),
      GROUPS.map((g) => {
        const rows = byGroup.get(g.code) ?? [];
        if (rows.length === 0) return null;
        return el('section', { class: 'cat-group' },
          el('h3', { class: 'cat-group-title' }, g.label),
          el('ul', { class: 'cat-list' }, rows.map((c) => el('li', { class: 'cat-row' },
            el('button', {
              class: `cat-button ${c.archived ? 'cat-archived' : ''}`, type: 'button',
              onclick: () => editCategory(c),
            },
              el('span', { class: 'cat-name' }, c.name),
              c.archived ? el('span', { class: 'cat-tag' }, 'เก็บแล้ว') : null,
              (c.aliases ?? []).length > 0
                ? el('span', { class: 'cat-aliases' }, c.aliases.join(', '))
                : null,
            ),
          ))),
        );
      }),
    );
  }

  function editCategory(cat) {
    const used = app.store.active.filter((t) => t.type === cat.name).length;

    const handle = openSheet({
      title: cat.name,
      body: el('div', { class: 'form' },
        el('p', { class: 'field-hint' },
          `${groupLabel(cat.group)} — ใช้อยู่ ${formatNumber(used)} รายการ`),

        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            const next = await promptText({
              title: 'เปลี่ยนชื่อประเภท', label: 'ชื่อใหม่', value: cat.name,
            });
            if (!next || next === cat.name) return;
            if (used > 0) {
              const ok = await confirmDialog({
                title: 'เปลี่ยนชื่อย้อนหลังด้วยไหม?',
                message: `รายการเดิม ${formatNumber(used)} รายการที่ใช้ “${cat.name}” จะเปลี่ยนเป็น “${next}” ด้วย`,
                confirmText: 'เปลี่ยนทั้งหมด',
              });
              if (!ok) return;
            }
            const changed = await app.store.renameCategory(cat.name, next);
            toast(`เปลี่ยนชื่อแล้ว (${formatNumber(changed)} รายการ)`);
            rerender();
          },
        }, 'เปลี่ยนชื่อ'),

        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: () => {
            handle.close();
            openPicker({
              title: 'ย้ายไปกลุ่ม',
              items: GROUPS.map((g) => ({ label: g.label, value: g.code })),
              selected: cat.group,
              onSelect: async (group) => {
                const changed = await app.store.setCategoryGroup(cat.name, group);
                toast(`ย้ายไป ${groupLabel(group)} แล้ว (${formatNumber(changed)} รายการ)`);
                rerender();
              },
            });
          },
        }, 'เปลี่ยนกลุ่ม'),

        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            const next = await promptText({
              title: 'คำเรียกอื่น', label: 'คั่นด้วยเครื่องหมายจุลภาค',
              value: (cat.aliases ?? []).join(', '),
              hint: 'เช่น ข้าว, กิน — ใช้ตอนพิมพ์สั้น ๆ ให้แอปเดาประเภทถูก',
            });
            if (next === undefined) return;
            await app.store.setCategoryAliases(cat.name, next.split(','));
            toast('บันทึกคำเรียกอื่นแล้ว');
            rerender();
          },
        }, 'คำเรียกอื่น'),

        el('button', {
          class: 'btn btn-block', type: 'button',
          onclick: async () => {
            handle.close();
            await app.store.setCategoryArchived(cat.name, !cat.archived);
            toast(cat.archived ? 'นำกลับมาใช้แล้ว' : 'เก็บประเภทแล้ว');
            rerender();
          },
        }, cat.archived ? 'นำกลับมาใช้' : 'เก็บเข้าคลัง'),

        cat.archived
          ? null
          : el('p', { class: 'field-hint' },
              'เก็บเข้าคลังจะซ่อนประเภทนี้จากรายการเลือก แต่รายการเดิมยังอยู่ครบ'),
      ),
    });
  }

  // ------------------------------------------------------------- งบเริ่มต้น
  function budgetsCard() {
    const settings = app.store.settings;
    const rows = settings.categories
      .filter((c) => !c.archived)
      .map((c) => ({ cat: c, value: settings.budgets.defaults?.[c.name] ?? 0 }))
      .filter((r) => r.value > 0);

    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-title' }, 'งบ / เป้าหมายเริ่มต้น'),
        el('button', { class: 'btn btn-small', type: 'button', onclick: pickBudgetCategory }, 'ตั้งค่า'),
      ),
      el('p', { class: 'field-hint' }, 'ค่านี้ใช้กับทุกเดือน ปรับเฉพาะเดือนได้ที่หน้าเดือน'),
      rows.length === 0
        ? el('p', { class: 'hint' }, 'ยังไม่ได้ตั้งงบไว้')
        : el('table', { class: 'budget-table' },
            el('thead', {}, el('tr', {},
              el('th', {}, 'ประเภท'), el('th', {}, 'กลุ่ม'), el('th', { class: 'num' }, 'จำนวน'))),
            el('tbody', {}, rows.map(({ cat, value }) => el('tr', {},
              el('td', {}, el('button', {
                class: 'link-cell', type: 'button',
                onclick: () => editDefaultBudget(cat, value),
              }, cat.name)),
              el('td', {}, groupLabel(cat.group)),
              el('td', { class: 'num' }, formatNumber(value)),
            ))),
          ),
    );
  }

  function pickBudgetCategory() {
    const settings = app.store.settings;
    const items = settings.categories
      .filter((c) => !c.archived)
      .map((c) => ({
        label: c.name, value: c.name, group: c.group,
        hint: formatNumber(settings.budgets.defaults?.[c.name] ?? 0),
      }));
    openPicker({
      title: 'เลือกประเภท',
      items,
      groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
      onSelect: (name) => {
        const cat = settings.categories.find((c) => c.name === name);
        editDefaultBudget(cat, settings.budgets.defaults?.[name] ?? 0);
      },
    });
  }

  async function editDefaultBudget(cat, current) {
    const word = targetWord(cat.group);
    const value = await promptNumber({
      title: cat.name,
      label: `${word} ต่อเดือน (บาท)`,
      value: current,
      hint: `${groupLabel(cat.group)} — ใช้กับทุกเดือน`,
    });
    if (value === undefined) return;
    await app.store.setBudget(cat.name, value ?? 0, { scope: 'default' });
    toast(`ตั้ง${word}แล้ว`);
    rerender();
  }

  // ------------------------------------------------------------------ ช่วยเหลือ
  function helpCard() {
    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'เรื่องที่ควรรู้'),
      el('ul', { class: 'help-list' },
        el('li', {},
          'บน iPhone ข้อมูลของแอปที่เพิ่มไว้ในหน้าจอโฮม จะ',
          el('strong', {}, 'แยกคนละที่'),
          'กับ Safari ปกติ ถ้าจะนำเข้าข้อมูล ให้เปิดจากไอคอนบนหน้าจอโฮมแล้วนำเข้าที่นั่น'),
        el('li', {}, 'ข้อมูลเก็บอยู่ในเครื่องนี้เท่านั้น ยังไม่ได้ซิงก์ขึ้นคลาวด์ จึงควรส่งออกไฟล์สำรองเป็นระยะ'),
        el('li', {}, 'ถ้าลบแอปออกจากหน้าจอโฮม ข้อมูลจะหายไปด้วย'),
        el('li', {}, 'ใส่วันที่ย้อนหลังหรือล่วงหน้าได้ รายการจะไปอยู่ในเดือนที่ถูกต้องเอง'),
      ),
    );
  }

  rerender();
  return host;
}
