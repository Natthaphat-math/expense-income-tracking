// บันทึกรายจ่ายจากหารกัน — การ์ดบนหน้าวัน และแผ่นตรวจก่อนบันทึก (เฉพาะเจ้าของแอป)

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, relativeDate, todayISO } from '../format.js';
import { splitSuggestions, suggestionCount } from '../split-suggest.js';
import { openSheet, toast } from '../ui.js';
import { icon, categoryTile } from '../icons.js';

function suggestions(app) {
  const split = app.split;
  if (!split || split.role !== 'owner') return null;
  return splitSuggestions({
    entries: split.entries,
    transactions: app.store.transactions,
    me: split.me,
    today: todayISO(),
    settings: app.store.settings,
    learned: app.store.learnedTypes,
  });
}

/** การ์ดบนหน้าวัน — มีเมื่อมีอะไรให้บันทึก/แก้ตามเท่านั้น */
export function splitLogCard(app) {
  const s = suggestions(app);
  if (!s || suggestionCount(s) === 0) return null;
  const parts = [];
  if (s.add.length) parts.push(`ใหม่ ${formatNumber(s.add.length)}`);
  if (s.update.length) parts.push(`ถูกแก้ ${formatNumber(s.update.length)}`);
  if (s.remove.length) parts.push(`ถูกลบ ${formatNumber(s.remove.length)}`);
  const total = s.add.reduce((t, a) => t + a.amount, 0);
  return el('button', { class: 'sort-prompt split-log-card', type: 'button', onclick: () => openReview(app) },
    el('span', { class: 'tile tile-sm tone-amber', 'aria-hidden': 'true' }, icon('repeat', { size: 16 })),
    el('span', { class: 'sort-prompt-text' },
      el('strong', {}, 'จากหารกัน · บันทึกเป็นรายจ่าย'),
      el('span', {}, `${parts.join(' · ')}${total > 0 ? ` · ส่วนของฉัน ${formatMoney(Math.round(total * 100) / 100)}` : ''}`),
    ),
    icon('chevronRight', { size: 18, cls: 'sort-prompt-go' }),
  );
}

/** แผ่นตรวจ: ติ๊ก = บันทึก/แก้ตาม · ไม่ติ๊ก = ข้าม (ไม่เสนออีก) */
export function openReview(app) {
  const s = suggestions(app);
  if (!s || suggestionCount(s) === 0) { toast('ไม่มีรายการจากหารกันให้บันทึก'); return; }
  const them = app.split.nameOf(app.split.partner);
  // รายการที่น่าจะบันทึกเองไปแล้ว ไม่ติ๊กไว้ก่อน
  const picked = new Set([
    ...s.add.filter((a) => !a.duplicate).map((a) => a.entry.id),
    ...s.update.map((u) => u.entry.id),
    ...s.remove.map((r) => r.entry.id),
  ]);
  const body = el('div', { class: 'form split-log' });
  const saveButton = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => save() }, 'บันทึก');

  function shareNote(entry) {
    if (entry.debtor === app.split.me) return `${them}จ่ายให้`;
    return `หารจาก ${formatNumber(entry.total)}`;
  }

  function row(id, { title, sub, amount, tileName, warn = null }) {
    const on = picked.has(id);
    return el('li', { class: `split-log-row ${on ? 'is-on' : ''}` },
      el('button', {
        class: 'split-log-pick', type: 'button', 'aria-pressed': on ? 'true' : 'false',
        'aria-label': `${on ? 'ไม่เลือก' : 'เลือก'} ${title} ${formatMoney(amount)}`,
        onclick: () => { if (on) picked.delete(id); else picked.add(id); paint(); },
      },
        el('span', { class: `split-tick-mark ${on ? 'is-on' : ''}`, 'aria-hidden': 'true' }, on ? icon('check', { size: 16 }) : null),
        categoryTile(tileName, 'DE', { size: 'sm' }),
        el('span', { class: 'split-log-main' },
          el('span', { class: 'split-log-title' }, title),
          el('span', { class: 'split-log-sub' }, sub),
          warn ? el('span', { class: 'split-log-warn' }, warn) : null,
        ),
        el('span', { class: 'split-log-amount' }, formatNumber(amount)),
      ),
    );
  }

  function paint() {
    replace(body,
      el('p', { class: 'field-hint' }, 'ลงเป็นรายจ่ายตามวันที่ของรายการ เฉพาะส่วนที่เป็นของฉัน · การโอนคืนไม่นับ (ไม่งั้นนับซ้ำ) · ที่ไม่ได้ติ๊กจะไม่ถูกเสนออีก'),
      s.add.length
        ? el('section', {},
            el('h3', { class: 'split-log-head' }, 'รายการใหม่'),
            el('ul', { class: 'split-log-list' }, s.add.map((a) => row(a.entry.id, {
              title: a.name,
              sub: `${relativeDate(a.date)} · ${a.type ?? 'ยังไม่มีประเภท'} · ${shareNote(a.entry)}`,
              amount: a.amount,
              tileName: a.type ?? a.name,
              warn: a.duplicate ? `อาจบันทึกไว้แล้ว: ${a.duplicate.name} ${formatNumber(a.duplicate.amount)}` : null,
            }))))
        : null,
      s.update.length
        ? el('section', {},
            el('h3', { class: 'split-log-head' }, 'หารกันถูกแก้ — แก้ตาม'),
            el('ul', { class: 'split-log-list' }, s.update.map((u) => row(u.entry.id, {
              title: u.tx.name,
              sub: [
                (u.tx.amount ?? 0) !== u.amount ? `เดิม ${formatNumber(u.tx.amount ?? 0)} → ${formatNumber(u.amount)}` : null,
                u.tx.date !== u.date ? `วันที่ ${relativeDate(u.tx.date)} → ${relativeDate(u.date)}` : relativeDate(u.date),
              ].filter(Boolean).join(' · '),
              amount: u.amount,
              tileName: u.tx.type ?? u.tx.name,
            }))))
        : null,
      s.remove.length
        ? el('section', {},
            el('h3', { class: 'split-log-head' }, 'หารกันถูกลบหรือไม่ต้องคืน — ลบรายจ่ายนี้'),
            el('ul', { class: 'split-log-list' }, s.remove.map((r) => row(r.entry.id, {
              title: r.tx.name,
              sub: `${relativeDate(r.tx.date)} · ${r.entry.deleted ? 'ถูกลบจากหารกัน' : 'ไม่ต้องคืนแล้ว'}`,
              amount: r.tx.amount ?? 0,
              tileName: r.tx.type ?? r.tx.name,
            }))))
        : null,
    );
    saveButton.textContent = picked.size > 0 ? `บันทึก ${formatNumber(picked.size)} รายการ` : 'ข้ามทั้งหมด';
  }

  async function save() {
    const writes = [];
    const undo = [];
    for (const a of s.add) {
      const on = picked.has(a.entry.id);
      // ข้าม = เก็บไว้แบบลบแล้ว จะได้ไม่เสนออีก (ซิงก์ไปทุกเครื่อง)
      writes.push({
        kind: 'expense', name: a.name.slice(0, 200), amount: a.amount, date: a.date,
        type: a.type, group: a.group, splitRef: a.entry.id, deleted: !on,
      });
    }
    for (const u of s.update) {
      undo.push({ id: u.tx.id, before: u.tx });
      // ไม่แก้ตาม = แตะไว้ให้ใหม่กว่าหารกัน จะได้ไม่ถามอีก
      writes.push(picked.has(u.entry.id) ? { ...u.tx, amount: u.amount, date: u.date } : { ...u.tx });
    }
    for (const r of s.remove) {
      undo.push({ id: r.tx.id, before: r.tx });
      writes.push(picked.has(r.entry.id) ? { ...r.tx, deleted: true } : { ...r.tx });
    }
    handle.close();
    const saved = await app.store.saveMany(writes);
    for (const tx of saved.slice(0, s.add.length)) undo.push({ id: tx.id, before: null });
    const added = s.add.filter((a) => picked.has(a.entry.id)).length;
    const changed = picked.size - added;
    const message = picked.size === 0
      ? 'ข้ามแล้ว — จะไม่เสนอรายการเหล่านี้อีก'
      : [added ? `บันทึก ${formatNumber(added)} รายการ` : null, changed ? `แก้ตาม ${formatNumber(changed)} รายการ` : null].filter(Boolean).join(' · ');
    // เลิกทำ: รายการที่เพิ่ง "บันทึก/ข้าม" ลบออกพร้อมตัด splitRef ทิ้ง — จะได้กลับมาอยู่ในรายการเสนออีก
    app.notifyUndoable(message, undo, async (list) => {
      const store = app.store;
      await store.saveMany(list.map(({ id, before }) => (before
        ? { ...before }
        : { ...store.byId(id), deleted: true, splitRef: null })).filter((t) => t && t.id));
    });
    app.render();
  }

  const handle = openSheet({
    title: 'บันทึกจากหารกัน',
    fullHeight: true,
    body,
    actions: [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยังก่อน'),
      saveButton,
    ],
  });
  paint();
}
