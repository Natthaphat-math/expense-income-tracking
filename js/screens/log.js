// หน้าบันทึกรายการ — พิมพ์อิสระแล้วแอปเติมช่องให้ พร้อมโหมดหลายรายการ

import { el, replace } from '../dom.js';
import { formatMoney, relativeDate, entryDayISO, isLateNight, addDays, todayISO } from '../format.js';
import {
  activeCategories, groupLabel, groupsForKind, groupForCategory,
  defaultGroupFor, normalizeAmount, GROUPS,
} from '../model.js';
import { parseLine, parseText, isBatch } from '../parser.js';
import {
  openPicker, openDatePicker, confirmDialog, toast, openSheet, promptText,
} from '../ui.js';
import { deleteTransaction } from './home.js';
import { icon, categoryTile } from '../icons.js';

const DEBOUNCE_MS = 220;

export function renderLog(app, options = {}) {
  const editing = options.transaction ?? null;
  // จากปุ่มบันทึกด่วน: กรอกชื่อ มูลค่า และประเภทที่ใช้ประจำไว้ให้ แก้ได้ก่อนกดบันทึก
  const prefill = editing ? null : (options.prefill ?? null);
  const startKind = editing?.kind ?? options.kind ?? 'expense';
  const touched = new Set(editing ? ['amount', 'type', 'group', 'date'] : (options.date ? ['date'] : []));
  if (prefill?.amount !== null && prefill?.amount !== undefined) touched.add('amount');
  if (prefill?.type) touched.add('type');
  const state = {
    kind: startKind,
    text: editing ? editing.name : (prefill?.name ?? ''),
    // ช่องที่ผู้ใช้แตะเอง — ตัวแปลงข้อความจะไม่เขียนทับ
    touched,
    amount: editing?.amount ?? prefill?.amount ?? null,
    type: editing?.type ?? prefill?.type ?? null,
    group: editing?.group
      ?? (prefill?.type ? groupForCategory(app.store.settings, prefill.type, startKind) : defaultGroupFor(startKind)),
    date: editing?.date ?? options.date ?? entryDayISO(),
    parsed: null,
    batch: null,
    dirty: false,
  };

  function setKind(kind) {
    if (kind === state.kind) return;
    state.kind = kind;
    if (!state.touched.has('group')) state.group = defaultGroupFor(state.kind);
    if (!state.touched.has('type')) state.type = null;
    // ประเภทเดิมอาจเป็นของอีกฝั่ง
    if (state.type && groupForCategory(app.store.settings, state.type, state.kind) !== state.group) {
      state.type = null;
      state.touched.delete('type');
    }
    state.dirty = true;
    reparse();
    render();
  }

  const kindSwitch = el('div', { class: 'seg seg-full seg-kind', role: 'group', 'aria-label': 'รายจ่ายหรือรายรับ' });

  // จดทีละหลายรายการเป็นวิธีหลัก (ส่วนใหญ่จดตอนกลางคืนรวดเดียวทั้งวัน) จึงให้ช่องสูงพอเห็นหลายบรรทัด
  const textarea = el('textarea', {
    class: 'input textarea',
    rows: editing ? '2' : '4',
    placeholder: editing ? 'รายละเอียด' : 'ข้าวมันไก่ 50\nชานม 45\nค่ารถ 30',
    'aria-label': editing ? 'รายละเอียด' : 'รายการ พิมพ์ทีละบรรทัด',
    autocapitalize: 'sentences',
    autocorrect: 'on',
    spellcheck: 'false',
    enterkeyhint: 'enter',
  });
  textarea.value = state.text;

  const fieldsHost = el('div', { class: 'log-fields' });
  const batchHost = el('div', { class: 'batch-host' });
  const chipHost = el('div', { class: 'chip-host' });

  let timer = null;
  textarea.addEventListener('input', () => {
    state.text = textarea.value;
    state.dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      reparse();
      render();
    }, DEBOUNCE_MS);
  });

  function parseOptions() {
    return {
      categories: app.store.settings.categories,
      kind: state.kind,
      learned: app.store.learnedTypes,
    };
  }

  function reparse() {
    if (isBatch(state.text)) {
      // โหมดหลายรายการ: แต่ละบรรทัดเป็นการ์ดหนึ่งใบ แก้ไขรายใบได้
      const rows = parseText(state.text, parseOptions());
      const previous = state.batch ?? [];
      state.batch = rows.map((row, index) => {
        const old = previous[index];
        // ถ้าผู้ใช้แก้ค่าในการ์ดไว้แล้ว และข้อความบรรทัดนั้นไม่เปลี่ยน ให้คงค่าไว้
        const keep = old && old.raw === row.raw ? old : null;
        return {
          raw: row.raw,
          name: keep?.nameTouched ? keep.name : row.name,
          amount: keep?.amountTouched ? keep.amount : row.amount,
          type: keep?.typeTouched ? keep.type : (row.type ?? row.suggestedType ?? null),
          date: keep?.dateTouched ? keep.date : null,
          unknownType: row.unknownType,
          nameTouched: keep?.nameTouched ?? false,
          amountTouched: keep?.amountTouched ?? false,
          typeTouched: keep?.typeTouched ?? false,
          dateTouched: keep?.dateTouched ?? false,
        };
      });
      state.parsed = null;
      // ช่องด้านบนเป็นค่าเริ่มต้นของทั้งชุด ไม่ใช่ค่าที่แกะมาจากบรรทัดแรก
      if (!state.touched.has('amount')) state.amount = null;
      if (!state.touched.has('type')) state.type = null;
      return;
    }

    state.batch = null;
    const parsed = parseLine(state.text, parseOptions());
    state.parsed = parsed;
    if (!state.touched.has('amount')) state.amount = parsed.amount;
    if (!state.touched.has('type')) {
      state.type = parsed.type ?? parsed.suggestedType ?? null;
      if (state.type && !state.touched.has('group')) {
        state.group = groupForCategory(app.store.settings, state.type, state.kind);
      }
    }
  }

  function setField(field, value) {
    state[field] = value;
    state.touched.add(field);
    state.dirty = true;
    if (field === 'type' && value) {
      const group = groupForCategory(app.store.settings, value, state.kind);
      if (!state.touched.has('group')) state.group = group;
      else state.group = group;
    }
    if (field === 'group') {
      // เลือกกลุ่มก่อน แล้วประเภทเดิมไม่เข้าพวก ให้ล้างทิ้ง
      if (state.type && groupForCategory(app.store.settings, state.type, state.kind) !== value) {
        state.type = null;
        state.touched.delete('type');
      }
    }
    render();
  }

  function pickType() {
    const cats = activeCategories(app.store.settings, { kind: state.kind });
    const items = cats.map((c) => ({
      label: c.name, value: c.name, group: c.group, aliases: c.aliases, tile: true,
    }));
    openPicker({
      title: 'เลือกประเภท',
      items,
      selected: state.type,
      searchPlaceholder: 'ค้นหาประเภท',
      groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
      onSelect: (value) => setField('type', value),
      extraAction: (close) => el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          close();
          await addCategoryFlow(app, state.kind, (name) => setField('type', name));
        },
      }, '+ เพิ่มประเภทใหม่'),
    });
  }

  function pickGroup() {
    const items = groupsForKind(state.kind).map((code) => ({
      label: groupLabel(code), value: code,
    }));
    openPicker({
      title: 'เลือกกลุ่มรายการ',
      items,
      selected: state.group,
      searchPlaceholder: 'ค้นหากลุ่ม',
      onSelect: (value) => setField('group', value),
    });
  }

  function pickDate(current, onPick) {
    openDatePicker({ value: current, onSelect: onPick });
  }

  function renderFields() {
    const amountInput = el('input', {
      class: 'input input-amount',
      type: 'text',
      inputmode: 'decimal',
      placeholder: '0',
      'aria-label': 'มูลค่า',
      value: state.amount === null ? '' : String(state.amount),
    });
    amountInput.addEventListener('input', () => {
      state.touched.add('amount');
      state.dirty = true;
      state.amount = normalizeAmount(amountInput.value.replace(/,/g, ''));
    });

    replace(fieldsHost,
      state.batch
        ? el('p', { class: 'fields-caption' }, 'ค่าเริ่มต้น — ใช้กับแถวที่ไม่ได้ระบุค่านั้นไว้')
        : null,
      el('div', { class: 'field' },
        el('span', { class: 'field-label' }, 'มูลค่า'),
        el('div', { class: 'input-with-suffix' }, amountInput, el('span', { class: 'input-suffix' }, 'บาท')),
      ),
      pickerField('ประเภท', state.type ?? 'ยังไม่ระบุ', !state.type, pickType,
        categoryTile(state.type, state.group, { size: 'sm' })),
      pickerField('กลุ่มรายการ', groupLabel(state.group), false, pickGroup),
      pickerField('วันที่', relativeDate(state.date), false, () => pickDate(state.date, (iso) => setField('date', iso))),
      !editing && isLateNight() && state.date === addDays(todayISO(), -1)
        ? el('p', { class: 'field-hint night-hint' }, 'เลยเที่ยงคืนแล้ว จึงลงเป็นของเมื่อวานให้ แตะช่องวันที่เพื่อเปลี่ยน')
        : null,
    );
  }

  function renderChips() {
    const chips = [];
    const parsed = state.parsed;

    if (parsed?.unknownType && !state.touched.has('type')) {
      chips.push(el('div', { class: 'chip-row' },
        el('button', {
          class: 'chip chip-suggest', type: 'button',
          onclick: async () => {
            const created = await app.store.addCategory(parsed.unknownType, state.group);
            setField('type', parsed.unknownType);
            if (created) toast(`เพิ่มประเภท “${parsed.unknownType}” แล้ว`);
          },
        }, `เพิ่มประเภทใหม่: ${parsed.unknownType}`),
        el('button', {
          class: 'chip chip-dismiss', type: 'button', 'aria-label': 'ไม่ใช้ข้อเสนอนี้',
          onclick: () => { parsed.unknownType = null; render(); },
        }, icon('close', { size: 18 })),
      ));
    }

    if (parsed?.suggestedType && state.type === parsed.suggestedType && !state.touched.has('type')) {
      chips.push(el('p', { class: 'hint hint-suggest' },
        `เติมประเภท “${parsed.suggestedType}” ให้จากที่เคยบันทึกไว้ แตะช่องประเภทเพื่อเปลี่ยนได้`));
    }

    replace(chipHost, chips);
  }

  function renderBatch() {
    if (!state.batch) {
      replace(batchHost);
      return;
    }
    replace(batchHost,
      el('p', { class: 'batch-title' }, `${state.batch.length} รายการ — ตรวจดูก่อนบันทึก`),
      el('ul', { class: 'batch-list' }, state.batch.map((row, index) => batchCard(row, index))),
    );
  }

  function batchCard(row, index) {
    const invalidName = row.name.trim().length === 0;
    return el('li', { class: `batch-card ${invalidName ? 'batch-card-bad' : ''}` },
      el('div', { class: 'batch-line' }, el('span', { class: 'batch-index' }, String(index + 1)), row.raw),
      el('div', { class: 'batch-fields' },
        batchChip(invalidName ? 'ยังไม่มีชื่อ' : row.name, invalidName, async () => {
          const next = await promptText({ title: 'รายละเอียด', label: 'ชื่อรายการ', value: row.name });
          if (next === undefined) return;
          row.name = next;
          row.nameTouched = true;
          render();
        }),
        batchChip(row.amount === null ? 'ไม่ระบุมูลค่า' : formatMoney(row.amount), row.amount === null, async () => {
          const next = await promptText({
            title: 'มูลค่า', label: 'มูลค่า (บาท)',
            value: row.amount === null ? '' : String(row.amount),
          });
          if (next === undefined) return;
          row.amount = normalizeAmount(next);
          row.amountTouched = true;
          render();
        }),
        batchChip(row.type ?? (row.unknownType ? `ไม่รู้จัก: ${row.unknownType}` : 'ไม่ระบุประเภท'),
          !row.type, () => {
            const cats = activeCategories(app.store.settings, { kind: state.kind });
            openPicker({
              title: 'เลือกประเภท',
              items: cats.map((c) => ({ label: c.name, value: c.name, group: c.group, aliases: c.aliases, tile: true })),
              selected: row.type,
              groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
              onSelect: (value) => { row.type = value; row.typeTouched = true; render(); },
              extraAction: (close) => el('button', {
                class: 'btn btn-primary', type: 'button',
                onclick: async () => {
                  close();
                  await addCategoryFlow(app, state.kind, (name) => {
                    row.type = name;
                    row.typeTouched = true;
                    render();
                  }, row.unknownType ?? '');
                },
              }, '+ เพิ่มประเภทใหม่'),
            });
          }),
        batchChip(relativeDate(row.date ?? state.date), false, () => {
          pickDate(row.date ?? state.date, (iso) => { row.date = iso; row.dateTouched = true; render(); });
        }),
      ),
    );
  }

  function batchChip(label, warn, onClick) {
    return el('button', { class: `chip ${warn ? 'chip-warn' : ''}`, type: 'button', onclick: onClick }, label);
  }

  async function cancel() {
    if (state.dirty) {
      const ok = await confirmDialog({
        title: 'ทิ้งสิ่งที่พิมพ์ไว้?',
        message: 'ข้อมูลที่ยังไม่ได้บันทึกจะหายไป',
        confirmText: 'ทิ้งเลย',
        danger: true,
      });
      if (!ok) return;
    }
    app.back();
  }

  async function save() {
    if (state.batch) {
      const rows = state.batch.filter((r) => r.name.trim().length > 0);
      if (rows.length === 0) {
        toast('ยังไม่มีรายการที่บันทึกได้');
        return;
      }
      const saved = await app.store.saveMany(rows.map((r) => ({
        kind: state.kind,
        name: r.name.trim(),
        amount: r.amount,
        type: r.type,
        group: r.type ? groupForCategory(app.store.settings, r.type, state.kind) : state.group,
        date: r.date ?? state.date,
      })));
      app.back();
      app.notifyUndoable(`บันทึกแล้ว ${rows.length} รายการ`, saved.map((t) => ({ id: t.id, before: null })));
      return;
    }

    const name = (state.parsed?.name ?? state.text).trim();
    if (!name) {
      toast('กรุณากรอกรายละเอียดก่อน');
      textarea.focus();
      return;
    }

    const before = editing ? app.store.byId(editing.id) : null;
    const saved = await app.store.save({
      id: editing?.id,
      createdAt: editing?.createdAt,
      kind: state.kind,
      name,
      amount: state.amount,
      type: state.type,
      group: state.type ? groupForCategory(app.store.settings, state.type, state.kind) : state.group,
      date: state.date,
    });
    app.back();
    app.notifyUndoable(editing ? 'แก้ไขรายการแล้ว' : 'บันทึกแล้ว', [{ id: saved.id, before }]);
  }

  function render() {
    // โหมดหลายรายการบอกจำนวนบนปุ่ม จะได้รู้ว่ากดแล้วได้กี่รายการ
    const count = state.batch ? state.batch.filter((r) => r.name.trim().length > 0).length : 0;
    saveButton.textContent = state.batch && count > 0 ? `บันทึก ${count} รายการ` : 'บันทึก';
    replace(kindSwitch, [['expense', 'รายจ่าย'], ['income', 'รายรับ']].map(([kind, label]) => el('button', {
      class: `seg-item seg-kind-${kind} ${state.kind === kind ? 'seg-item-on' : ''}`, type: 'button',
      'aria-pressed': state.kind === kind ? 'true' : 'false',
      onclick: () => setKind(kind),
    }, label)));
    renderFields();
    renderChips();
    renderBatch();
  }

  const saveButton = el('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'บันทึก');

  reparse();
  render();

  return el('div', { class: 'screen screen-log' },
    el('header', { class: 'log-head' },
      el('h1', { class: 'log-title' }, editing ? 'แก้ไขรายการ' : 'บันทึกรายการ'),
      editing
        ? el('button', {
            class: 'btn-icon btn-icon-danger', type: 'button', 'aria-label': 'ลบรายการ',
            onclick: async () => { if (await deleteTransaction(app, editing)) app.back(); },
          }, icon('trash'))
        : el('span', { class: 'btn-icon-placeholder' }),
    ),
    el('main', { class: 'log-body' },
      kindSwitch,
      el('div', { class: 'field' },
        el('span', { class: 'field-label' }, editing ? 'รายละเอียด' : 'รายการ'),
        textarea,
        editing
          ? null
          : el('p', { class: 'field-hint' },
              el('strong', {}, 'ขึ้นบรรทัดใหม่ = อีกรายการ'),
              ' จดของทั้งวันในครั้งเดียวได้ พิมพ์หรือพูดก็ได้ เช่น “ก๋วยเตี๋ยว 20 บาท อาหาร”'),
      ),
      chipHost,
      fieldsHost,
      batchHost,
    ),
    el('div', { class: 'log-actions' },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, 'ยกเลิก'),
      saveButton,
    ),
  );
}

/** ช่องที่แตะแล้วเปิดตัวเลือก (ประเภท / กลุ่ม / วันที่) */
function pickerField(label, value, isEmpty, onClick, lead = null) {
  return el('button', {
    class: `picker-field ${isEmpty ? 'picker-field-empty' : ''}`,
    type: 'button',
    onclick: onClick,
  },
    el('span', { class: 'field-label' }, label),
    el('span', { class: 'picker-field-value' }, lead, el('span', {}, value)),
    icon('chevronRight', { size: 18, cls: 'picker-field-mark' }),
  );
}

/** กล่องเพิ่มประเภทใหม่ — ถามชื่อและกลุ่ม */
export async function addCategoryFlow(app, kind, onDone, initialName = '') {
  const groups = groupsForKind(kind);
  let chosenGroup = groups[0];

  const nameInput = el('input', {
    class: 'input', type: 'text', value: initialName, placeholder: 'ชื่อประเภท',
    'aria-label': 'ชื่อประเภท', autocapitalize: 'off',
  });

  const groupHost = el('div', { class: 'seg' });
  const renderGroups = () => {
    replace(groupHost, groups.map((code) => el('button', {
      class: `seg-item ${code === chosenGroup ? 'seg-item-on' : ''}`, type: 'button',
      onclick: () => { chosenGroup = code; renderGroups(); },
    }, groupLabel(code))));
  };
  renderGroups();

  const handle = openSheet({
    title: 'เพิ่มประเภทใหม่',
    body: el('div', { class: 'form' },
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ชื่อประเภท'), nameInput),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'กลุ่มรายการ'), groupHost),
    ),
    actions: [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast('กรุณาตั้งชื่อประเภท');
            return;
          }
          const created = await app.store.addCategory(name, chosenGroup);
          handle.close();
          if (created) toast(`เพิ่มประเภท “${name}” แล้ว`);
          onDone(name);
        },
      }, 'เพิ่ม'),
    ],
  });
  setTimeout(() => nameInput.focus(), 120);
}
