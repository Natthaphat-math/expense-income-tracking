// หน้าจัดประเภท — รวมรายการที่ยังไม่ระบุประเภทตามชื่อ แล้วตั้งทีละกลุ่ม
// ตั้งครั้งเดียวได้ทุกรายการที่ชื่อเดียวกัน แทนการแตะทีละแถว

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, relativeDate } from '../format.js';
import {
  activeCategories, groupForCategory, groupKind, GROUPS,
} from '../model.js';
import { suggestType } from '../parser.js';
import { openPicker, confirmDialog, pageHeader } from '../ui.js';
import { icon, categoryTile } from '../icons.js';

const PAGE_SIZE = 25;

export function renderSort(app) {
  const state = { shown: PAGE_SIZE, skipped: new Set() };
  const host = el('div', { class: 'screen screen-sort' });

  const rerender = () => replace(host, build());

  function suggestionFor(group) {
    return suggestType(group.name, {
      categories: app.store.settings.categories,
      kind: group.kind,
      learned: app.store.learnedTypes,
    });
  }

  function build() {
    const groups = app.store.untypedGroups().filter((g) => !state.skipped.has(g.key));
    const total = groups.reduce((sum, g) => sum + g.count, 0);
    const withSuggestion = groups.map((g) => ({ group: g, suggestion: suggestionFor(g) }));
    const fromHistory = withSuggestion.filter((x) => x.suggestion?.source === 'history');

    return [
      pageHeader({
        kicker: 'รายการที่ยังไม่ระบุประเภท',
        title: 'จัดประเภท',
        actions: [el('button', {
          class: 'btn btn-small btn-tonal', type: 'button', onclick: () => app.back(),
        }, 'เสร็จ')],
      }),
      groups.length === 0
        ? doneState()
        : [
            el('p', { class: 'sort-lead' },
              `เหลือ ${formatNumber(total)} รายการ จาก ${formatNumber(groups.length)} ชื่อ — ตั้งครั้งเดียวได้ทุกรายการที่ชื่อเดียวกัน`),
            fromHistory.length >= 2 ? bulkCard(fromHistory) : null,
            el('ul', { class: 'sort-list' },
              withSuggestion.slice(0, state.shown).map(({ group, suggestion }) => groupCard(group, suggestion))),
            withSuggestion.length > state.shown
              ? el('button', {
                  class: 'btn btn-block', type: 'button',
                  onclick: () => { state.shown += PAGE_SIZE; rerender(); },
                }, `แสดงอีก ${formatNumber(Math.min(PAGE_SIZE, withSuggestion.length - state.shown))} ชื่อ`)
              : null,
          ],
    ];
  }

  /** ใช้ประเภทเดิมกับทุกชื่อที่เคยตั้งไว้แล้ว — เฉพาะที่มาจากประวัติ ไม่รวมที่เดา */
  function bulkCard(items) {
    const count = items.reduce((sum, x) => sum + x.group.count, 0);
    return el('section', { class: 'card sort-bulk' },
      el('div', { class: 'sort-bulk-text' },
        el('strong', {}, `${formatNumber(items.length)} ชื่อเคยตั้งประเภทไว้แล้ว`),
        el('span', {}, `ใช้ประเภทเดิมกับ ${formatNumber(count)} รายการได้ในครั้งเดียว`),
      ),
      el('button', {
        class: 'btn btn-small btn-primary', type: 'button',
        onclick: async () => {
          const preview = items.slice(0, 6).map((x) => `• ${x.group.name} → ${x.suggestion.type}`).join('\n');
          const more = items.length > 6 ? `\nและอีก ${formatNumber(items.length - 6)} ชื่อ` : '';
          const ok = await confirmDialog({
            title: `ตั้งประเภท ${formatNumber(count)} รายการ?`,
            message: `${preview}${more}\n\nเลิกทำได้ทันทีหลังจากนี้`,
            confirmText: 'ใช้ทั้งหมด',
          });
          if (!ok) return;
          await apply(items.map((x) => ({ group: x.group, type: x.suggestion.type })),
            `ตั้งประเภทแล้ว ${formatNumber(count)} รายการ`);
        },
      }, 'ใช้ทั้งหมด'),
    );
  }

  function groupCard(group, suggestion) {
    const isIncome = group.kind === 'income';
    return el('li', { class: 'sort-card' },
      el('div', { class: 'sort-head' },
        categoryTile(null, isIncome ? 'IN' : 'DE'),
        el('div', { class: 'sort-text' },
          el('span', { class: 'sort-name' }, group.name || '(ไม่มีชื่อ)'),
          el('span', { class: 'sort-meta' },
            `${formatNumber(group.count)} รายการ · ${formatMoney(group.total)}`,
            isIncome ? ' · รายรับ' : '',
            ` · ล่าสุด ${relativeDate(group.lastDate)}`),
        ),
      ),
      el('div', { class: 'sort-actions' },
        suggestion
          ? el('button', {
              class: 'sort-suggest', type: 'button',
              'aria-label': `ใช้ประเภท ${suggestion.type} กับ ${group.name} ${group.count} รายการ`,
              onclick: () => apply([{ group, type: suggestion.type }],
                `ตั้ง “${group.name}” เป็น ${suggestion.type} แล้ว`),
            },
              categoryTile(suggestion.type, groupForCategory(app.store.settings, suggestion.type, group.kind), { size: 'sm' }),
              el('span', { class: 'sort-suggest-text' },
                el('span', { class: 'sort-suggest-type' }, suggestion.type),
                el('span', { class: 'sort-suggest-why' },
                  suggestion.source === 'history' ? 'เคยใช้กับชื่อนี้' : 'เดาจากชื่อ'),
              ),
              icon('check', { size: 18 }),
            )
          : null,
        el('div', { class: 'sort-more' },
          el('button', {
            class: 'btn btn-small', type: 'button',
            onclick: () => pick(group),
          }, suggestion ? 'ประเภทอื่น' : 'เลือกประเภท'),
          el('button', {
            class: 'btn btn-small btn-ghost', type: 'button',
            onclick: () => { state.skipped.add(group.key); rerender(); },
          }, 'ข้าม'),
        ),
      ),
    );
  }

  function pick(group) {
    const cats = activeCategories(app.store.settings, { kind: group.kind });
    openPicker({
      title: `ประเภทของ “${group.name}”`,
      items: cats.map((c) => ({ label: c.name, value: c.name, group: c.group, aliases: c.aliases, tile: true })),
      searchPlaceholder: 'ค้นหาประเภท',
      groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
      onSelect: (name) => apply([{ group, type: name }], `ตั้ง “${group.name}” เป็น ${name} แล้ว`),
    });
  }

  /** ตั้งประเภทให้ทุกรายการในกลุ่ม พร้อมปุ่มเลิกทำ */
  async function apply(choices, message) {
    const updates = [];
    const undo = [];
    for (const { group, type } of choices) {
      const code = groupForCategory(app.store.settings, type, group.kind);
      for (const id of group.ids) {
        const tx = app.store.byId(id);
        if (!tx || tx.deleted || tx.type) continue;
        undo.push({ id, before: tx });
        updates.push({ ...tx, type, group: code, kind: groupKind(code) });
      }
    }
    if (updates.length === 0) return;
    await app.store.saveMany(updates);
    rerender();
    app.notifyUndoable(message, undo);
  }

  function doneState() {
    return el('div', { class: 'empty' },
      el('span', { class: 'empty-mark', 'aria-hidden': 'true' }, icon('check', { size: 28 })),
      el('p', { class: 'empty-title' }, 'ทุกรายการมีประเภทแล้ว'),
      el('p', { class: 'empty-hint' }, 'กราฟและงบในหน้าเดือนจะแยกตามประเภทได้ครบ'),
      el('button', { class: 'btn btn-primary btn-block sort-done', type: 'button', onclick: () => app.back() }, 'กลับ'),
    );
  }

  rerender();
  return host;
}
