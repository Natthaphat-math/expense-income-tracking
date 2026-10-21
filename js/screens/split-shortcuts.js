// ทางลัดหารกัน — รายการที่ใส่บ่อย (ใช้ร่วมกันทั้งสองคน ซิงก์ผ่าน Firestore)

import { el, replace } from '../dom.js';
import { formatNumber } from '../format.js';
import { normalizeAmount, newId } from '../model.js';
import { BUCKETS, bucketFor, bucketLabel } from '../split-model.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';

const MAX_SHORTCUTS = 12;

/** การ์ดในหน้าตั้งค่า — แสดงเมื่อเชื่อมหารกันได้แล้ว */
export function shortcutsCard(app) {
  const split = app.split;
  if (!split || split.status !== 'ready') return null;
  const list = split.shortcuts;
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-title' }, 'ทางลัดหารกัน'),
      list.length < MAX_SHORTCUTS
        ? el('button', { class: 'btn btn-small', type: 'button', onclick: () => openShortcutEditor(app, null) }, 'เพิ่ม')
        : null,
    ),
    el('p', { class: 'field-hint' }, `กดทางลัดในหน้าหารกันแล้วใส่แค่ยอด · ใช้ร่วมกับ${split.nameOf(split.partner)}`),
    el('ul', { class: 'cat-list' }, list.map((sc) => el('li', { class: 'cat-row' },
      el('button', { class: 'cat-button', type: 'button', onclick: () => openShortcutEditor(app, sc) },
        el('span', { class: 'cat-text' },
          el('span', { class: 'cat-name' }, sc.name,
            sc.bucket !== 'general' ? el('span', { class: 'cat-tag' }, bucketLabel(sc.bucket)) : null),
          el('span', { class: 'cat-aliases' }, describe(split, sc)),
        ),
        icon('chevronRight', { size: 18, cls: 'cat-mark' }),
      ),
    ))),
  );
}

function describe(split, sc) {
  const parts = [`${split.nameOf(sc.payer)}จ่าย`, sc.mode === 'half' ? 'หารครึ่ง' : 'ออกให้ทั้งหมด'];
  parts.push(sc.amount ? `${formatNumber(sc.amount)} บาท` : 'ใส่ยอดทุกครั้ง');
  return parts.join(' · ');
}

/** เพิ่ม/แก้ทางลัด — existing null = เพิ่มใหม่ */
export function openShortcutEditor(app, existing) {
  const split = app.split;
  if (!split || split.status !== 'ready') { toast('ยังเชื่อมต่อหารกันไม่ได้'); return; }
  const me = split.me;
  const partner = split.partner;
  const list = split.shortcuts;
  if (!existing && list.length >= MAX_SHORTCUTS) { toast(`ทางลัดได้ไม่เกิน ${MAX_SHORTCUTS} อัน`); return; }
  const f = existing
    ? { ...existing }
    : { id: newId(), name: '', payer: me, mode: 'full', amount: null, bucket: 'general' };
  let bucketTouched = Boolean(existing);

  const nameInput = el('input', {
    class: 'input', type: 'text', value: f.name, maxlength: '60', placeholder: 'เช่น ค่าน้ำ, ข้าวเช้า',
    'aria-label': 'ชื่อทางลัด',
    oninput: (ev) => {
      f.name = ev.target.value;
      if (!bucketTouched && f.bucket !== bucketFor(f.name)) { f.bucket = bucketFor(f.name); paint(); }
    },
  });
  const amountInput = el('input', {
    class: 'input input-amount', type: 'text', inputmode: 'decimal', placeholder: 'ไม่ใส่ = ใส่ทุกครั้ง',
    'aria-label': 'ยอดประจำ (บาท)', value: f.amount ? String(f.amount) : '',
    oninput: (ev) => { f.amount = normalizeAmount(ev.target.value.replace(/,/g, '')); },
  });
  const dynamic = el('div', { class: 'split-form-dynamic' });

  function paint() {
    replace(dynamic,
      seg('ใครจ่าย', [[me, 'ฉันจ่าย'], [partner, `${split.nameOf(partner)}จ่าย`]], f.payer, (v) => { f.payer = v; paint(); }),
      seg('แบ่งยังไง', [['full', 'ออกให้ทั้งหมด'], ['half', 'หารครึ่ง']], f.mode, (v) => { f.mode = v; paint(); }),
      seg('กลุ่ม', BUCKETS.map((b) => [b.id, b.label]), f.bucket, (v) => { f.bucket = v; bucketTouched = true; paint(); }),
    );
  }
  paint();

  const index = existing ? list.findIndex((s) => s.id === existing.id) : -1;
  const move = (step) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + step, 0, item);
    handle.close();
    save(app, next, []);
  };

  const handle = openSheet({
    title: existing ? 'แก้ทางลัด' : 'เพิ่มทางลัด',
    body: el('div', { class: 'form split-form' },
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ชื่อ'), nameInput),
      dynamic,
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ยอดประจำ'),
        el('div', { class: 'input-with-suffix' }, amountInput, el('span', { class: 'input-suffix' }, 'บาท')),
        el('p', { class: 'field-hint' }, 'ยอดที่จ่ายไปทั้งหมด (ก่อนหาร) — ยอดไม่ตายตัวก็เว้นไว้')),
      existing && list.length > 1
        ? el('div', { class: 'split-shortcut-order' },
            el('button', { class: 'btn btn-small', type: 'button', disabled: index === 0 ? '' : null, onclick: () => move(-1) },
              'เลื่อนขึ้น'),
            el('button', { class: 'btn btn-small', type: 'button', disabled: index === list.length - 1 ? '' : null, onclick: () => move(1) },
              'เลื่อนลง'),
          )
        : null,
    ),
    actions: [
      existing
        ? el('button', {
            class: 'btn btn-ghost btn-danger-text', type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: `ลบทางลัด “${existing.name}”?`,
                message: list.length === 1 ? 'ลบหมดแล้วจะกลับไปใช้ทางลัดชุดเริ่มต้น' : 'รายการที่บันทึกไว้แล้วไม่หาย',
                confirmText: 'ลบ',
                danger: true,
              });
              if (!ok) return;
              handle.close();
              save(app, list.filter((s) => s.id !== existing.id), [existing.id]);
            },
          }, 'ลบ')
        : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onclick: () => {
          const name = f.name.trim().slice(0, 60);
          if (!name) { toast('ใส่ชื่อทางลัด'); nameInput.focus(); return; }
          if (f.amount !== null && !(f.amount > 0)) { toast('ยอดต้องมากกว่า 0'); amountInput.focus(); return; }
          const item = { id: f.id, name, payer: f.payer, mode: f.mode, amount: f.amount || null, bucket: f.bucket };
          const next = existing ? list.map((s) => (s.id === existing.id ? item : s)) : [...list, item];
          handle.close();
          save(app, next, []);
        },
      }, 'บันทึก'),
    ],
  });
  if (!existing) setTimeout(() => nameInput.focus(), 150);
}

function save(app, list, removed) {
  app.split.saveShortcuts(list, removed)
    .then(() => toast('บันทึกทางลัดแล้ว'))
    .catch((err) => toast(err?.message ?? 'บันทึกไม่สำเร็จ'));
}

function seg(label, options, value, onPick) {
  return el('div', { class: 'field' },
    el('span', { class: 'field-label' }, label),
    el('div', { class: 'seg seg-full', role: 'group', 'aria-label': label },
      options.map(([v, text]) => el('button', {
        class: `seg-item ${v === value ? 'seg-item-on' : ''}`, type: 'button',
        'aria-pressed': v === value ? 'true' : 'false',
        onclick: () => onPick(v),
      }, text))),
  );
}
