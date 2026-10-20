// หน้าหารกัน — ใครจ่ายแทนใคร ยอดค้างสุทธิ การโอนคืน (บางส่วนได้) และการเคลียร์

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, relativeDate, entryDayISO } from '../format.js';
import { normalizeAmount } from '../model.js';
import { openSheet, openDatePicker, confirmDialog, toast, pageHeader } from '../ui.js';
import { icon } from '../icons.js';

const HISTORY_LIMIT = 60;

export function renderSplit(app) {
  const split = app.split;
  const state = { showHistory: false };
  const host = el('div', { class: 'screen screen-split' });
  const partnerMode = split?.role === 'partner';

  const rerender = () => replace(host, build());

  function build() {
    const partner = split.partner;
    const them = split.nameOf(partner);
    return [
      pageHeader({
        kicker: split.status === 'ready' ? `ใช้ร่วมกับ ${them}` : 'ใช้ร่วมกันสองคน',
        title: 'หารกัน',
        actions: [partnerMode
          ? el('button', {
              class: 'round-btn', type: 'button', 'aria-label': 'ตั้งค่า',
              onclick: () => app.go('settings'),
            }, icon('sliders'))
          : el('button', {
              class: 'btn btn-small btn-tonal', type: 'button', onclick: () => app.back(),
            }, 'เสร็จ')],
      }),
      split.status === 'ready' ? ready(them) : notReady(),
    ];
  }

  function notReady() {
    const text = {
      loading: 'กำลังเชื่อมต่อ…',
      off: 'เข้าสู่ระบบที่หน้าตั้งค่าก่อน แล้วรายการที่ใช้ร่วมกันจะขึ้นที่นี่',
      none: 'บัญชีนี้ยังไม่ได้อยู่ในหารกัน — ต้องเพิ่มอีเมลในการตั้งค่า Firebase ก่อน',
      error: split.lastError ?? 'เชื่อมต่อไม่สำเร็จ',
    }[split.status] ?? '';
    return el('div', { class: 'empty' },
      el('span', { class: 'empty-mark', 'aria-hidden': 'true' }, icon('repeat', { size: 28 })),
      el('p', { class: 'empty-title' }, split.status === 'loading' ? 'รอสักครู่' : 'ยังใช้หารกันไม่ได้'),
      el('p', { class: 'empty-hint' }, text),
    );
  }

  function ready(them) {
    const { net, open, history } = split.summary();
    split.markSeen();
    return [
      balanceCard(net, open, them),
      el('button', { class: 'btn btn-primary btn-block split-add', type: 'button', onclick: () => editItem(null) },
        icon('plus', { size: 20 }), ' เพิ่มรายการ'),
      el('section', { class: 'split-section' },
        el('div', { class: 'section-head' },
          el('h2', { class: 'section-title' }, 'ยังไม่เคลียร์'),
          open.length > 0 ? el('span', { class: 'section-meta' }, `${formatNumber(open.length)} รายการ`) : null,
        ),
        open.length === 0
          ? el('p', { class: 'split-empty' }, 'ไม่มีรายการค้าง')
          : el('ul', { class: 'tx-list' }, open.map((e) => row(e, false))),
      ),
      history.length > 0
        ? el('section', { class: 'split-section' },
            el('button', {
              class: 'split-history-toggle', type: 'button',
              'aria-expanded': state.showHistory ? 'true' : 'false',
              onclick: () => { state.showHistory = !state.showHistory; rerender(); },
            },
              el('span', {}, `เคลียร์แล้ว (${formatNumber(history.length)})`),
              icon('chevronDown', { cls: `collapse-mark ${state.showHistory ? 'collapse-mark-open' : ''}` }),
            ),
            state.showHistory
              ? el('ul', { class: 'tx-list' }, history.slice(0, HISTORY_LIMIT).map((e) => row(e, true)))
              : null,
          )
        : null,
      split.pending ? el('p', { class: 'footnote split-pending' }, 'มีรายการที่ยังรอส่ง — จะส่งให้เองเมื่อมีเน็ต') : null,
    ];
  }

  /** ยอดสุทธิ — บวก = อีกฝ่ายค้างฉัน */
  function balanceCard(net, open, them) {
    const owedToMe = net > 0;
    const headline = net === 0 ? 'ไม่มียอดค้าง' : owedToMe ? `${them} ค้างฉัน` : `ฉันค้าง ${them}`;
    return el('section', { class: `hero-card split-balance ${net === 0 ? 'is-clear' : owedToMe ? 'is-owed' : 'is-owing'}` },
      el('p', { class: 'hero-label' }, headline),
      el('p', { class: 'hero-amount' },
        formatNumber(Math.abs(net)), el('span', { class: 'hero-unit' }, ' บาท')),
      net !== 0 || open.length > 0
        ? el('div', { class: 'split-balance-actions' },
            net !== 0
              ? el('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => recordPayment(net) },
                  'บันทึกการโอนคืน')
              : null,
            open.length > 0
              ? el('button', { class: 'btn btn-small', type: 'button', onclick: () => settleAll(open, net, them) },
                  'เคลียร์ทั้งหมด')
              : null,
          )
        : null,
    );
  }

  function row(e, inHistory) {
    const payer = split.nameOf(e.creditor);
    const debtor = split.nameOf(e.debtor);
    const isPayment = e.kind === 'payment';
    const mineToPay = e.debtor === split.me;
    const title = isPayment ? `${debtor} โอนคืน${e.name ? ` · ${e.name}` : ''}` : e.name;
    let sub;
    if (inHistory && e.clearedBy === 'used') {
      sub = `หักยอดค้างหมดแล้ว · ${relativeDate(e.date)}`;
    } else if (inHistory) {
      sub = e.clearedBy === 'payment'
        ? `โอนคืนครบแล้ว · ${relativeDate(e.date)}`
        : `เคลียร์โดย ${split.nameOf(e.settledBy) || '—'}${e.settledAt ? ` · ${relativeDate(isoOf(e.settledAt))}` : ''}`;
    } else if (isPayment) {
      sub = `ให้ ${payer} · ${relativeDate(e.date)} · ยังไม่ได้หัก ${formatNumber(e.remaining)}`;
    } else {
      const parts = [`${payer} จ่าย`, relativeDate(e.date)];
      if (e.total && e.total > e.amount) parts.push(`จากทั้งหมด ${formatNumber(e.total)}`);
      if (e.partly) parts.push(`โอนคืนแล้วบางส่วน`);
      sub = parts.join(' · ');
    }
    const amountText = formatNumber(inHistory || isPayment ? e.amount : e.remaining);
    const amountLabel = isPayment ? 'โอนแล้ว' : `${mineToPay ? 'ฉัน' : debtor}ค้าง`;

    return el('li', { class: `tx-row split-row ${inHistory ? 'is-history' : ''}` },
      // การโอนคืนไม่มีปุ่มเคลียร์ — หักรายการค้างให้เองแล้วย้ายไปประวัติ
      inHistory || isPayment
        ? null
        : el('button', {
            class: 'split-tick', type: 'button',
            'aria-label': `เคลียร์แล้ว: ${title} ${formatMoney(e.remaining)}`,
            onclick: () => tick(e),
          }, el('span', { class: 'split-tick-mark', 'aria-hidden': 'true' })),
      el('button', {
        class: 'tx-button', type: 'button',
        onclick: () => (isPayment ? recordPayment(0, e) : editItem(e)),
      },
        el('span', { class: `tile tile-md ${isPayment ? 'tone-teal' : mineToPay ? 'tone-orange' : 'tone-blue'}`, 'aria-hidden': 'true' },
          icon(isPayment ? 'repeat' : 'receipt')),
        el('span', { class: 'tx-main' },
          el('span', { class: 'tx-name' }, title),
          el('span', { class: 'tx-sub' }, sub),
        ),
        el('span', { class: 'split-amount' },
          el('span', { class: 'split-amount-value' }, amountText),
          el('span', { class: 'split-amount-label' }, inHistory ? 'บาท' : amountLabel),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ การกระทำ
  function settle(list) {
    const undo = list.map((e) => ({ id: e.id, before: split.byId(e.id) }));
    split.save(list.map((e) => ({ ...split.byId(e.id), settled: true, settledBy: null, settledAt: null })));
    app.notifyUndoable(list.length === 1 ? `เคลียร์ “${list[0].name || 'โอนคืน'}” แล้ว` : `เคลียร์ ${formatNumber(list.length)} รายการแล้ว`,
      undo, (u) => split.revert(u));
  }

  /**
   * ติ๊กเคลียร์รายการ — ถ้าเคยโอนคืนมาบางส่วนแล้ว จะบันทึกเป็นการโอนส่วนที่เหลือแทน
   * (ไม่งั้นเงินที่โอนมาแล้วจะไปหักรายการอื่นซ้ำ ยอดค้างจะเพี้ยน)
   */
  async function tick(e) {
    if (!e.partly) {
      settle([e]);
      return;
    }
    const ok = await confirmDialog({
      title: `เคลียร์ “${e.name}”?`,
      message: `โอนคืนมาแล้ว ${formatMoney(e.amount - e.remaining)} จาก ${formatMoney(e.amount)}\nจะบันทึกว่าโอนส่วนที่เหลือ ${formatMoney(e.remaining)} แล้ว`,
      confirmText: 'เคลียร์ส่วนที่เหลือ',
    });
    if (!ok) return;
    const entry = split.draft({
      kind: 'payment', debtor: e.debtor, creditor: e.creditor, amount: e.remaining,
      name: `เคลียร์ ${e.name}`.slice(0, 200), date: entryDayISO(),
    });
    split.save([entry]);
    app.notifyUndoable(`เคลียร์ “${e.name}” แล้ว`, [{ id: entry.id, before: null }], (u) => split.revert(u));
  }

  async function settleAll(open, net, them) {
    // ทุกอย่างที่ยังไม่เคลียร์ — รวมการโอนที่หักรายการไปแล้ว (อยู่ในประวัติ) ด้วย
    // ไม่งั้นการโอนนั้นจะเหลือค้างเป็นยอดติดลบหลังเคลียร์รายการทั้งหมด
    const unsettled = split.entries.filter((e) => !e.settled && !e.deleted);
    const ok = await confirmDialog({
      title: `เคลียร์ทั้งหมด ${formatNumber(open.filter((e) => e.kind === 'item').length || open.length)} รายการ?`,
      message: net === 0
        ? 'ทุกรายการจะย้ายไปอยู่ในเคลียร์แล้ว'
        : `${net > 0 ? `${them} ค้างฉัน` : `ฉันค้าง ${them}`} ${formatMoney(Math.abs(net))}\nเคลียร์แล้วยอดค้างจะเป็น 0`,
      confirmText: 'เคลียร์ทั้งหมด',
    });
    if (ok) settle(unsettled);
  }

  /** เพิ่ม/แก้รายการที่จ่ายแทนกัน */
  function editItem(existing) {
    const me = split.me;
    const partner = split.partner;
    const f = existing
      ? {
          payer: existing.creditor,
          name: existing.name,
          total: existing.total ?? existing.amount,
          mode: !existing.total || existing.total === existing.amount
            ? 'full'
            : Math.abs(existing.total / 2 - existing.amount) < 0.01 ? 'half' : 'custom',
          owed: existing.amount,
          date: existing.date,
        }
      : { payer: me, name: '', total: null, mode: 'full', owed: null, date: entryDayISO() };

    const body = el('div', { class: 'form split-form' });
    const nameInput = el('input', {
      class: 'input', type: 'text', value: f.name, placeholder: 'เช่น ข้าวกะเพรา, ค่าแท็กซี่', 'aria-label': 'จ่ายค่าอะไร',
      maxlength: '200', oninput: (ev) => { f.name = ev.target.value; },
    });
    const totalInput = el('input', {
      class: 'input input-amount', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'จ่ายไป (บาท)',
      value: f.total === null ? '' : String(f.total),
      oninput: (ev) => { f.total = normalizeAmount(ev.target.value.replace(/,/g, '')); paint(); },
    });
    const owedInput = el('input', {
      class: 'input input-amount', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'ส่วนที่ต้องคืน (บาท)',
      value: f.owed === null ? '' : String(f.owed),
      oninput: (ev) => { f.owed = normalizeAmount(ev.target.value.replace(/,/g, '')); paint(); },
    });
    const dynamic = el('div', { class: 'split-form-dynamic' });

    const owedAmount = () => {
      if (f.total === null) return null;
      if (f.mode === 'full') return f.total;
      if (f.mode === 'half') return Math.round((f.total / 2) * 100) / 100;
      return f.owed;
    };

    function paint() {
      const debtor = f.payer === me ? partner : me;
      const owed = owedAmount();
      replace(dynamic,
        seg('ใครจ่าย', [[me, 'ฉันจ่าย'], [partner, `${split.nameOf(partner)}จ่าย`]], f.payer, (v) => { f.payer = v; paint(); }),
        seg('แบ่งยังไง', [['full', 'ออกให้ทั้งหมด'], ['half', 'หารครึ่ง'], ['custom', 'กำหนดเอง']], f.mode,
          (v) => { f.mode = v; paint(); }),
        f.mode === 'custom'
          ? el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ส่วนที่ต้องคืน'),
              el('div', { class: 'input-with-suffix' }, owedInput, el('span', { class: 'input-suffix' }, 'บาท')))
          : null,
        el('button', {
          class: 'picker-field', type: 'button',
          onclick: () => openDatePicker({ value: f.date, onSelect: (iso) => { f.date = iso; paint(); } }),
        },
          el('span', { class: 'field-label' }, 'วันที่'),
          el('span', { class: 'picker-field-value' }, relativeDate(f.date)),
          icon('chevronRight', { size: 18, cls: 'picker-field-mark' }),
        ),
        el('p', { class: 'split-preview', role: 'status' },
          owed && owed > 0
            ? `${debtor === me ? `ฉันค้าง ${split.nameOf(f.payer)}` : `${split.nameOf(debtor)} ค้างฉัน`} ${formatMoney(owed)}`
            : 'ใส่ยอดที่จ่ายไป'),
      );
    }

    replace(body,
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'จ่ายค่าอะไร'), nameInput),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'จ่ายไป'),
        el('div', { class: 'input-with-suffix' }, totalInput, el('span', { class: 'input-suffix' }, 'บาท'))),
      dynamic,
    );
    paint();

    const handle = openSheet({
      title: existing ? 'แก้รายการ' : 'เพิ่มรายการหารกัน',
      body,
      fullHeight: true,
      actions: [
        existing
          ? el('button', {
              class: 'btn btn-ghost btn-danger-text', type: 'button',
              onclick: () => { handle.close(); remove(existing); },
            }, 'ลบ')
          : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => {
            const owed = owedAmount();
            if (!f.name.trim()) { toast('ใส่ว่าจ่ายค่าอะไร'); nameInput.focus(); return; }
            if (!f.total || !owed || owed <= 0) { toast('ใส่ยอดที่จ่ายไป'); totalInput.focus(); return; }
            if (owed > f.total) { toast('ส่วนที่ต้องคืนมากกว่ายอดที่จ่ายไม่ได้'); return; }
            const debtor = f.payer === me ? partner : me;
            const entry = {
              ...(existing ?? split.draft({ kind: 'item' })),
              debtor, creditor: f.payer,
              amount: owed,
              total: f.mode === 'full' ? null : f.total,
              name: f.name.trim(),
              date: f.date,
            };
            const before = existing ? split.byId(existing.id) : null;
            handle.close();
            split.save([entry]);
            app.notifyUndoable(existing ? 'แก้รายการแล้ว' : 'เพิ่มรายการแล้ว',
              [{ id: entry.id, before }], (u) => split.revert(u));
          },
        }, 'บันทึก'),
      ],
    });
    if (!existing) setTimeout(() => nameInput.focus(), 150);
  }

  /** บันทึกการโอนคืน (บางส่วนได้) — net > 0 แปลว่าอีกฝ่ายต้องโอนให้ฉัน */
  function recordPayment(net, existing = null) {
    const me = split.me;
    const partner = split.partner;
    const f = existing
      ? { from: existing.debtor, amount: existing.amount, note: existing.name, date: existing.date }
      : { from: net > 0 ? partner : me, amount: Math.abs(net) || null, note: '', date: entryDayISO() };

    const body = el('div', { class: 'form split-form' });
    const amountInput = el('input', {
      class: 'input input-amount', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'ยอดที่โอน (บาท)',
      value: f.amount === null ? '' : String(f.amount),
      oninput: (ev) => { f.amount = normalizeAmount(ev.target.value.replace(/,/g, '')); },
    });
    const noteInput = el('input', {
      class: 'input', type: 'text', value: f.note, placeholder: 'ไม่ใส่ก็ได้', 'aria-label': 'หมายเหตุ', maxlength: '200',
      oninput: (ev) => { f.note = ev.target.value; },
    });
    const dynamic = el('div', { class: 'split-form-dynamic' });
    function paint() {
      replace(dynamic,
        seg('ใครโอน', [[me, 'ฉันโอน'], [partner, `${split.nameOf(partner)}โอน`]], f.from, (v) => { f.from = v; paint(); }),
        el('button', {
          class: 'picker-field', type: 'button',
          onclick: () => openDatePicker({ value: f.date, onSelect: (iso) => { f.date = iso; paint(); } }),
        },
          el('span', { class: 'field-label' }, 'วันที่'),
          el('span', { class: 'picker-field-value' }, relativeDate(f.date)),
          icon('chevronRight', { size: 18, cls: 'picker-field-mark' }),
        ),
      );
    }
    replace(body,
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'ยอดที่โอน'),
        el('div', { class: 'input-with-suffix' }, amountInput, el('span', { class: 'input-suffix' }, 'บาท'))),
      !existing && net !== 0
        ? el('p', { class: 'field-hint' }, `ยอดค้างตอนนี้ ${formatMoney(Math.abs(net))} — โอนบางส่วนก็ได้`)
        : null,
      dynamic,
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'หมายเหตุ'), noteInput),
    );
    paint();

    const handle = openSheet({
      title: existing ? 'แก้การโอนคืน' : 'บันทึกการโอนคืน',
      body,
      actions: [
        existing
          ? el('button', { class: 'btn btn-ghost btn-danger-text', type: 'button', onclick: () => { handle.close(); remove(existing); } }, 'ลบ')
          : el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => {
            if (!f.amount || f.amount <= 0) { toast('ใส่ยอดที่โอน'); amountInput.focus(); return; }
            const entry = {
              ...(existing ?? split.draft({ kind: 'payment' })),
              debtor: f.from,
              creditor: f.from === me ? partner : me,
              amount: f.amount,
              total: null,
              name: f.note.trim(),
              date: f.date,
            };
            const before = existing ? split.byId(existing.id) : null;
            handle.close();
            split.save([entry]);
            app.notifyUndoable(existing ? 'แก้การโอนคืนแล้ว' : `บันทึกการโอน ${formatMoney(f.amount)} แล้ว`,
              [{ id: entry.id, before }], (u) => split.revert(u));
          },
        }, 'บันทึก'),
      ],
    });
  }

  function remove(entry) {
    const before = split.byId(entry.id);
    split.save([{ ...before, deleted: true }]);
    app.notifyUndoable(`ลบ “${entry.name || 'โอนคืน'}” แล้ว`, [{ id: entry.id, before }], (u) => split.revert(u));
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

  rerender();
  return host;
}

function isoOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** การ์ดเล็กบนหน้าวัน — ยอดค้างและจำนวนรายการใหม่จากอีกฝ่าย */
export function splitCard(app) {
  const split = app.split;
  if (!split || split.role !== 'owner') return null;
  const { net } = split.summary();
  const them = split.nameOf(split.partner);
  const unseen = split.unseen;
  return el('button', { class: 'sort-prompt split-card', type: 'button', onclick: () => app.go('split') },
    el('span', { class: 'tile tile-sm tone-blue', 'aria-hidden': 'true' }, icon('repeat', { size: 16 })),
    el('span', { class: 'sort-prompt-text' },
      el('strong', {}, net === 0 ? 'หารกัน · ไม่มียอดค้าง' : net > 0
        ? `${them} ค้างฉัน ${formatMoney(net)}`
        : `ฉันค้าง ${them} ${formatMoney(-net)}`),
      el('span', {}, unseen > 0 ? `${them}เพิ่มหรือแก้ ${formatNumber(unseen)} รายการ` : `หารกันกับ ${them}`),
    ),
    unseen > 0 ? el('span', { class: 'split-badge' }, `ใหม่ ${formatNumber(unseen)}`) : null,
    icon('chevronRight', { size: 18, cls: 'sort-prompt-go' }),
  );
}
