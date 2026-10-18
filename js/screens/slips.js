// หน้านำเข้าสลิป — เลือกหลายรูปจากเครื่อง อ่านในเครื่อง แล้วให้ตรวจก่อนบันทึก
//
// กันซ้ำสามชั้น: สลิปเดิมที่เคยนำเข้า (เลขอ้างอิงใน QR / ลายนิ้วมือไฟล์), สลิปซ้ำในชุดที่เลือก,
// และรายการที่เคยพิมพ์เองซึ่งน่าจะเป็นรายการเดียวกัน (ให้เลือกรวมกันได้)

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, relativeDate, shortDate } from '../format.js';
import {
  activeCategories, groupForCategory, groupKind, defaultGroupFor, normalizeAmount, GROUPS,
} from '../model.js';
import { suggestType } from '../parser.js';
import { stripTitle } from '../slip-parse.js';
import { openSlipReader } from '../slip-reader.js';
import { findImported, findSimilar } from '../duplicates.js';
import {
  openPicker, openDatePicker, openSheet, confirmDialog, toast, pageHeader,
} from '../ui.js';
import { icon, categoryTile } from '../icons.js';

const SELF_NAME = 'โอนเข้าบัญชีตัวเอง';

let nextId = 1;

export function renderSlips(app) {
  const state = {
    items: [],
    status: null,      // ข้อความสถานะระหว่างอ่าน
    busy: false,
  };
  const host = el('div', { class: 'screen screen-slips' });
  const picker = el('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden',
    'aria-hidden': 'true', tabindex: '-1',
    onchange: () => {
      const files = [...picker.files];
      picker.value = '';
      if (files.length > 0) readAll(files);
    },
  });

  const rerender = () => replace(host, build(), picker);

  // ------------------------------------------------------------- อ่านสลิป
  async function readAll(files) {
    state.busy = true;
    const batch = files.map((file) => ({
      id: nextId++,
      file,
      thumb: URL.createObjectURL(file),
      status: 'waiting',
      draft: null,
      flag: null,
      picked: false,
      merge: false,
    }));
    state.items.push(...batch);
    state.status = 'กำลังเตรียมตัวอ่านสลิป — ครั้งแรกต้องดาวน์โหลดราว 5 MB';
    rerender();

    let reader = null;
    try {
      reader = await openSlipReader(({ stage, progress }) => {
        if (stage === 'loading' && typeof progress === 'number') {
          state.status = `กำลังเตรียมตัวอ่านสลิป ${Math.round(progress * 100)}%`;
          rerender();
        }
      });
      for (const [index, item] of batch.entries()) {
        state.status = `กำลังอ่าน ${formatNumber(index + 1)} จาก ${formatNumber(batch.length)}`;
        item.status = 'reading';
        rerender();
        try {
          const result = await reader.read(item.file);
          item.result = result;
          item.draft = makeDraft(result, item.file);
          item.status = 'done';
        } catch (err) {
          console.warn('อ่านสลิปไม่สำเร็จ', err);
          item.status = 'error';
          item.draft = makeDraft({}, item.file);
        }
        classify(item);
        rerender();
      }
    } catch (err) {
      console.error('เปิดตัวอ่านสลิปไม่สำเร็จ', err);
      for (const item of batch) {
        if (item.status !== 'done') {
          item.status = 'error';
          item.draft = makeDraft({}, item.file);
          classify(item);
        }
      }
      toast('เปิดตัวอ่านสลิปไม่สำเร็จ ลองต่อเน็ตแล้วเลือกใหม่อีกครั้ง');
    } finally {
      await reader?.close();
      state.busy = false;
      state.status = null;
      rerender();
    }
  }

  function makeDraft(result, file) {
    const self = Boolean(result.selfTransfer);
    const name = self ? SELF_NAME : (stripTitle(result.to) || (result.bankName ? `โอนเงิน ${result.bankName}` : 'โอนเงิน'));
    const date = result.date ?? localDate(file.lastModified);
    const suggestion = self ? null : suggestType(name, {
      categories: app.store.settings.categories,
      kind: 'expense',
      learned: app.store.learnedTypes,
    });
    return {
      kind: 'expense',
      name,
      amount: result.amount ?? null,
      date,
      time: result.time ?? null,
      type: suggestion?.type ?? null,
      ref: result.ref ?? null,
      hash: result.hash ?? null,
      bankName: result.bankName ?? null,
    };
  }

  /** ตัดสินว่าสลิปนี้ควรติ๊กไว้ไหม และเพราะอะไร */
  function classify(item) {
    const d = item.draft;
    const earlier = state.items.slice(0, state.items.indexOf(item))
      .find((other) => other.draft && ((d.ref && other.draft.ref === d.ref) || (d.hash && other.draft.hash === d.hash)));
    const imported = findImported(app.store.active, { ref: d.ref, hash: d.hash });
    const similar = findSimilar(app.store.active, d, 'manual')[0] ?? null;

    if (imported) item.flag = { kind: 'imported', tx: imported };
    else if (earlier) item.flag = { kind: 'repeat' };
    else if (item.result?.selfTransfer) item.flag = { kind: 'self' };
    else if (item.status === 'error' || d.amount === null || !item.result?.date) item.flag = { kind: 'unreadable' };
    else if (similar) item.flag = { kind: 'manual', tx: similar };
    else item.flag = null;

    item.picked = item.flag === null;
    item.merge = false;
  }

  // ---------------------------------------------------------------- หน้าจอ
  function build() {
    const picked = state.items.filter((i) => i.picked && i.draft);
    return [
      pageHeader({
        kicker: 'นำเข้าจากรูปในเครื่อง',
        title: 'สลิปโอนเงิน',
        actions: [el('button', { class: 'btn btn-small btn-tonal', type: 'button', onclick: cancel }, 'ยกเลิก')],
      }),
      state.items.length === 0 ? intro() : null,
      state.status ? el('p', { class: 'slip-status', role: 'status' }, state.status) : null,
      state.items.length > 0
        ? el('ul', { class: 'slip-list' }, state.items.map((item) => slipCard(item)))
        : null,
      state.items.length > 0 && !state.busy
        ? el('button', { class: 'btn btn-block slip-more', type: 'button', onclick: choose },
            icon('plus', { size: 18 }), ' เลือกสลิปเพิ่ม')
        : null,
      state.items.length > 0
        ? el('div', { class: 'log-actions' },
            el('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, 'ยกเลิก'),
            el('button', {
              class: 'btn btn-primary', type: 'button',
              disabled: state.busy || picked.length === 0 ? true : null,
              onclick: save,
            }, picked.length > 0 ? `บันทึก ${formatNumber(picked.length)} รายการ` : 'ยังไม่ได้เลือก'),
          )
        : null,
    ];
  }

  function intro() {
    return el('section', { class: 'card slip-intro' },
      el('span', { class: 'empty-mark', 'aria-hidden': 'true' }, icon('image', { size: 28 })),
      el('p', { class: 'empty-title' }, 'เลือกสลิปได้ทีละหลายรูป'),
      el('p', { class: 'empty-hint' },
        'แอปอ่านจำนวนเงิน วันที่ และชื่อผู้รับให้ แล้วให้ตรวจก่อนบันทึก สลิปที่เคยนำเข้าแล้วจะถูกข้ามให้เอง เลือกซ้ำได้ไม่ต้องกังวล'),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: choose },
        icon('image', { size: 20 }), ' เลือกสลิปจากรูปภาพ'),
      el('p', { class: 'footnote' },
        'อ่านในเครื่องนี้เท่านั้น รูปไม่ถูกส่งไปที่ไหนและไม่ถูกเก็บไว้ — เก็บแค่เลขอ้างอิงของสลิปเพื่อกันนำเข้าซ้ำ'),
    );
  }

  function choose() {
    picker.click();
  }

  function slipCard(item) {
    const d = item.draft;
    const reading = !d;
    return el('li', { class: `slip-card ${item.picked ? 'slip-card-on' : ''}` },
      el('div', { class: 'slip-head' },
        reading
          ? el('span', { class: 'slip-check slip-check-wait', 'aria-hidden': 'true' })
          : el('button', {
              class: 'slip-check-button', type: 'button',
              'aria-pressed': item.picked ? 'true' : 'false',
              'aria-label': `${item.picked ? 'ไม่นำเข้า' : 'นำเข้า'} ${d.name} ${formatMoney(d.amount)}`,
              onclick: () => { item.picked = !item.picked; rerender(); },
            }, el('span', { class: `slip-check ${item.picked ? 'slip-check-on' : ''}`, 'aria-hidden': 'true' },
              item.picked ? icon('check', { size: 16 }) : null)),
        el('button', {
          class: 'slip-thumb', type: 'button', 'aria-label': 'ดูรูปสลิป',
          onclick: () => showImage(item),
        }, el('img', { src: item.thumb, alt: '' })),
        el('div', { class: 'slip-sum' },
          reading
            ? el('span', { class: 'slip-name' }, item.status === 'reading' ? 'กำลังอ่าน…' : 'รอคิว')
            : [
                el('span', { class: 'slip-name' }, d.name),
                el('span', { class: 'slip-meta' },
                  [
                    d.amount !== null ? formatMoney(d.amount) : 'ไม่พบจำนวนเงิน',
                    relativeDate(d.date),
                    d.time,
                    d.bankName,
                  ].filter(Boolean).join(' · ')),
              ],
        ),
      ),
      d && item.flag ? flagLine(item) : null,
      d && item.picked && !item.merge ? fields(item) : null,
    );
  }

  function flagLine(item) {
    const f = item.flag;
    const tx = f.tx;
    const text = {
      imported: tx ? `นำเข้าแล้วเมื่อ ${shortDate(tx.date)} — ${tx.name}` : 'นำเข้าแล้ว',
      repeat: 'สลิปเดียวกับที่เลือกไว้ด้านบน',
      self: 'โอนเข้าบัญชีตัวเอง — ไม่นับเป็นรายจ่าย ติ๊กถ้าอยากบันทึก (เช่นโอนไปออม)',
      unreadable: 'อ่านได้ไม่ครบ ตรวจจำนวนเงินและวันที่ก่อนติ๊กนำเข้า',
      manual: tx ? `อาจบันทึกเองแล้ว: ${tx.name} ${formatMoney(tx.amount)} (${relativeDate(tx.date)})` : '',
    }[f.kind];
    const tone = f.kind === 'unreadable' || f.kind === 'manual' ? 'warn' : 'info';

    return el('div', { class: `slip-flag slip-flag-${tone}` },
      el('span', { class: 'slip-flag-text' }, text),
      f.kind === 'manual'
        ? el('div', { class: 'slip-flag-actions' },
            el('button', {
              class: `btn btn-small ${item.merge ? 'btn-primary' : ''}`, type: 'button',
              'aria-pressed': item.merge ? 'true' : 'false',
              onclick: () => { item.merge = !item.merge; item.picked = item.merge; rerender(); },
            }, item.merge ? 'จะรวมกับรายการเดิม' : 'รวมกัน'),
            item.merge ? null : el('button', {
              class: 'btn btn-small btn-ghost', type: 'button',
              onclick: () => { item.picked = !item.picked; rerender(); },
            }, item.picked ? 'ไม่นำเข้า' : 'บันทึกแยก'),
          )
        : null,
      item.merge ? el('p', { class: 'slip-flag-note' }, 'เก็บชื่อและประเภทเดิมไว้ ใช้จำนวนเงินจากสลิป') : null,
    );
  }

  function fields(item) {
    const d = item.draft;
    const name = el('input', {
      class: 'input', type: 'text', value: d.name, 'aria-label': 'ชื่อรายการ',
      oninput: (e) => { d.name = e.target.value; },
    });
    const amount = el('input', {
      class: 'input input-amount', type: 'text', inputmode: 'decimal',
      value: d.amount === null ? '' : String(d.amount), placeholder: '0', 'aria-label': 'จำนวนเงิน (บาท)',
      oninput: (e) => { d.amount = normalizeAmount(e.target.value.replace(/,/g, '')); },
    });
    const group = d.type ? groupForCategory(app.store.settings, d.type, d.kind) : defaultGroupFor(d.kind);

    return el('div', { class: 'slip-fields' },
      el('div', { class: 'seg seg-full seg-kind', role: 'group', 'aria-label': 'รายจ่ายหรือรายรับ' },
        [['expense', 'รายจ่าย'], ['income', 'รายรับ']].map(([kind, label]) => el('button', {
          class: `seg-item seg-kind-${kind} ${d.kind === kind ? 'seg-item-on' : ''}`, type: 'button',
          'aria-pressed': d.kind === kind ? 'true' : 'false',
          onclick: () => {
            if (d.kind === kind) return;
            d.kind = kind;
            d.type = null;
            rerender();
          },
        }, label))),
      name,
      el('div', { class: 'slip-row' },
        el('div', { class: 'input-with-suffix slip-amount' }, amount, el('span', { class: 'input-suffix' }, 'บาท')),
        el('button', {
          class: 'chip slip-chip', type: 'button', 'aria-label': `วันที่ ${relativeDate(d.date)} — แตะเพื่อเปลี่ยน`,
          onclick: () => openDatePicker({ value: d.date, onSelect: (iso) => { d.date = iso; rerender(); } }),
        }, relativeDate(d.date)),
      ),
      el('button', {
        class: `picker-field ${d.type ? '' : 'picker-field-empty'}`, type: 'button',
        onclick: () => pickType(item),
      },
        el('span', { class: 'field-label' }, 'ประเภท'),
        el('span', { class: 'picker-field-value' },
          categoryTile(d.type, group, { size: 'sm' }), el('span', {}, d.type ?? 'ยังไม่ระบุ')),
        icon('chevronRight', { size: 18, cls: 'picker-field-mark' }),
      ),
    );
  }

  function pickType(item) {
    const d = item.draft;
    const cats = activeCategories(app.store.settings, { kind: d.kind });
    openPicker({
      title: 'เลือกประเภท',
      items: cats.map((c) => ({ label: c.name, value: c.name, group: c.group, aliases: c.aliases, tile: true })),
      selected: d.type,
      searchPlaceholder: 'ค้นหาประเภท',
      groupLabels: Object.fromEntries(GROUPS.map((g) => [g.code, g.label])),
      onSelect: (name) => { d.type = name; rerender(); },
    });
  }

  function showImage(item) {
    openSheet({
      title: item.draft?.name ?? 'สลิป',
      fullHeight: true,
      body: el('img', { class: 'slip-full', src: item.thumb, alt: 'รูปสลิป' }),
    });
  }

  // ---------------------------------------------------------------- บันทึก
  async function save() {
    const picked = state.items.filter((i) => i.picked && i.draft);
    const bad = picked.find((i) => !i.merge && (i.draft.amount === null || !i.draft.name.trim()));
    if (bad) {
      toast('มีสลิปที่ยังไม่มีจำนวนเงินหรือชื่อ — แก้หรือเอาติ๊กออกก่อน');
      return;
    }

    const creates = [];
    const merges = [];
    const undo = [];
    for (const item of picked) {
      const d = item.draft;
      if (item.merge && item.flag?.tx) {
        const before = app.store.byId(item.flag.tx.id);
        if (!before) continue;
        merges.push({ ...before, amount: d.amount ?? before.amount, slipRef: d.ref, slipHash: d.hash });
        undo.push({ id: before.id, before });
        continue;
      }
      const group = d.type ? groupForCategory(app.store.settings, d.type, d.kind) : defaultGroupFor(d.kind);
      creates.push({
        kind: groupKind(group),
        name: d.name.trim(),
        amount: d.amount,
        type: d.type,
        group,
        date: d.date,
        createdAt: stamp(d.date, d.time),
        slipRef: d.ref,
        slipHash: d.hash,
      });
    }

    const saved = creates.length > 0 ? await app.store.saveMany(creates) : [];
    if (merges.length > 0) await app.store.saveMany(merges);
    for (const t of saved) undo.push({ id: t.id, before: null });

    cleanup();
    app.back();
    const parts = [];
    if (saved.length > 0) parts.push(`นำเข้า ${formatNumber(saved.length)} รายการ`);
    if (merges.length > 0) parts.push(`รวม ${formatNumber(merges.length)} รายการ`);
    app.notifyUndoable(`${parts.join(' · ')}แล้ว`, undo);
  }

  async function cancel() {
    if (state.items.some((i) => i.picked)) {
      const ok = await confirmDialog({
        title: 'ยกเลิกการนำเข้า?',
        message: 'สลิปที่อ่านไว้จะไม่ถูกบันทึก',
        confirmText: 'ยกเลิกการนำเข้า',
        cancelText: 'อยู่ต่อ',
        danger: true,
      });
      if (!ok) return;
    }
    cleanup();
    app.back();
  }

  function cleanup() {
    for (const item of state.items) URL.revokeObjectURL(item.thumb);
  }

  rerender();
  return host;
}

/** เวลาบนสลิปเป็นเวลาที่สร้างรายการ — ช่วยเรียงรายการในวันเดียวกันตามจริง */
function stamp(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time ?? '12:00').split(':').map(Number);
  const value = new Date(y, m - 1, d, hh, mm).getTime();
  return Number.isFinite(value) ? value : Date.now();
}

function localDate(ms) {
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
