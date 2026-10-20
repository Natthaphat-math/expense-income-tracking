// หน้าหารกัน — ใครจ่ายแทนใคร ยอดค้างสุทธิ การโอนคืน (บางส่วนได้) และการเคลียร์

import { el, replace } from '../dom.js';
import { formatMoney, formatNumber, relativeDate, entryDayISO, todayISO, monthNameShort } from '../format.js';
import { normalizeAmount } from '../model.js';
import { parseSplitText, SELF_WORDS } from '../split-parse.js';
import { openSheet, openDatePicker, confirmDialog, toast, pageHeader } from '../ui.js';
import { icon, categoryTile } from '../icons.js';

const HISTORY_LIMIT = 60;

export function renderSplit(app) {
  const split = app.split;
  // การเลือกเก็บไว้ที่ app.state — หน้าจอถูกวาดใหม่ทุกครั้งที่อีกฝ่ายแก้ข้อมูล การเลือกต้องไม่หาย
  app.state.splitSelected ??= new Set();
  const state = { showHistory: app.state.splitShowHistory ?? false, selected: app.state.splitSelected };
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
        actions: [
          split.status === 'ready'
            ? el('button', {
                class: 'round-btn', type: 'button', 'aria-label': `ตั้งชื่อเล่นให้${them}`,
                onclick: () => editNickname(),
              }, icon('pencil'))
            : null,
          partnerMode
          ? el('button', {
              class: 'round-btn', type: 'button', 'aria-label': 'ตั้งค่า',
              onclick: () => app.go('settings'),
            }, icon('sliders'))
          : el('button', {
              class: 'btn btn-small btn-tonal', type: 'button', onclick: () => app.back(),
            }, 'เสร็จ')].filter(Boolean),
      }),
      split.status === 'ready' ? ready(them) : notReady(),
    ];
  }

  function notReady() {
    const text = {
      loading: 'กำลังเชื่อมต่อ…',
      off: 'เข้าสู่ระบบที่หน้าตั้งค่าก่อน แล้วรายการที่ใช้ร่วมกันจะขึ้นที่นี่',
      none: `ไม่พบหารกันของ ${split.me ?? 'บัญชีนี้'} — ตรวจใน Firebase console ว่ามีเอกสาร pairs/main (collection “pairs” เอกสาร “main”) และอีเมลนี้อยู่ใน members แบบตัวพิมพ์เล็กตรงกันทุกตัว`,
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
    // "ใหม่" = อีกฝ่ายเพิ่ม/แก้หลังจากที่ฉันเปิดดูครั้งก่อน — จำเวลานั้นไว้ตลอดการเปิดหน้านี้ครั้งนี้
    // (หน้าถูกวาดใหม่ทุกครั้งที่ข้อมูลเปลี่ยน แต่ options ของหน้ายังเป็นตัวเดิม)
    const visit = app.current.options ?? {};
    visit.seenAt ??= split.seenAt();
    state.seenAt = visit.seenAt;
    split.markSeen();
    const selectable = open.filter((e) => e.kind === 'item');
    // ตัดรายการที่ไม่อยู่แล้ว (ถูกเคลียร์/ลบจากอีกเครื่อง) ออกจากการเลือก
    for (const id of [...state.selected]) if (!selectable.some((e) => e.id === id)) state.selected.delete(id);
    const picked = selectable.filter((e) => state.selected.has(e.id));
    document.body.classList.toggle('has-split-select', picked.length > 0);
    return [
      balanceCard(net, open, them),
      el('div', { class: 'split-add-row' },
        el('button', { class: 'btn btn-primary split-add', type: 'button', onclick: () => editItem(null) },
          icon('plus', { size: 20 }), ' เพิ่มรายการ'),
        el('button', { class: 'btn split-add', type: 'button', onclick: () => batchEntry() },
          icon('list', { size: 20 }), ' หลายบรรทัด'),
      ),
      selectable.length > 0
        ? el('div', { class: 'split-select-all' },
            el('button', {
              class: 'btn btn-small btn-ghost', type: 'button',
              onclick: () => {
                if (picked.length === selectable.length) state.selected.clear();
                else for (const e of selectable) state.selected.add(e.id);
                rerender();
              },
            }, picked.length === selectable.length ? 'ไม่เลือก' : `เลือกทั้งหมด (${formatNumber(selectable.length)})`),
          )
        : null,
      open.length === 0
        ? el('section', { class: 'split-section' },
            el('div', { class: 'section-head' }, el('h2', { class: 'section-title' }, 'ยังไม่เคลียร์')),
            el('p', { class: 'split-empty' }, 'ไม่มีรายการค้าง'),
          )
        : directionSections(open, them),
      history.length > 0
        ? el('section', { class: 'split-section' },
            el('button', {
              class: 'split-history-toggle', type: 'button',
              'aria-expanded': state.showHistory ? 'true' : 'false',
              onclick: () => {
                state.showHistory = !state.showHistory;
                app.state.splitShowHistory = state.showHistory;
                rerender();
              },
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
      picked.length > 0 ? selectBar(picked, net, them) : null,
    ];
  }

  /**
   * แยกรายการค้างตามทิศ พร้อมยอดรวมแต่ละฝั่ง — อ่านทิศจากหัวข้อ ไม่ต้องพึ่งสีไอคอน
   * การโอนที่ยังเหลือ (โอนเกิน) แยกไว้อีกกลุ่ม
   */
  function directionSections(open, them) {
    const groups = [
      { title: `${them} ค้างฉัน`, rows: open.filter((e) => e.kind === 'item' && e.creditor === split.me) },
      { title: `ฉันค้าง ${them}`, rows: open.filter((e) => e.kind === 'item' && e.debtor === split.me) },
      { title: 'โอนแล้ว ยังไม่ได้หัก', rows: open.filter((e) => e.kind === 'payment'), payments: true },
    ];
    return groups.filter((g) => g.rows.length > 0).map((g) => {
      const total = g.rows.reduce((sum, e) => sum + e.remaining, 0);
      return el('section', { class: 'split-section' },
        el('div', { class: 'section-head' },
          el('h2', { class: 'section-title' }, g.title),
          el('span', { class: 'section-meta' },
            `${formatNumber(g.rows.length)} รายการ · ${formatMoney(Math.round(total * 100) / 100)}`),
        ),
        el('ul', { class: 'tx-list' }, g.rows.map((e) => row(e, false))),
      );
    });
  }

  /** ยอดสุทธิของรายการที่เลือก จากมุมของฉัน (บวก = อีกฝ่ายค้างฉัน) */
  function netOf(list) {
    return Math.round(list.reduce((sum, e) => sum + (e.creditor === split.me ? e.remaining : -e.remaining), 0) * 100) / 100;
  }

  function owesText(value, them) {
    if (value === 0) return 'หักลบกันพอดี';
    return value > 0 ? `${them} ค้างฉัน ${formatMoney(value)}` : `ฉันค้าง ${them} ${formatMoney(-value)}`;
  }

  /** แถบล่างตอนเลือกรายการ: ยอดรวมของที่เลือก (แตะเพื่อคัดลอก) และปุ่มเคลียร์ */
  function selectBar(picked, net, them) {
    const value = netOf(picked);
    return el('div', { class: 'split-select-bar', role: 'region', 'aria-label': 'รายการที่เลือก' },
      el('div', { class: 'split-select-sum' },
        el('span', { class: 'split-select-count' }, `เลือก ${formatNumber(picked.length)} รายการ`),
        el('button', {
          class: 'split-select-total', type: 'button',
          'aria-label': `${owesText(value, them)} — แตะเพื่อคัดลอกยอด`,
          onclick: () => copyAmount(Math.abs(value)),
        }, owesText(value, them), value !== 0 ? icon('copy', { size: 16 }) : null),
      ),
      el('div', { class: 'split-select-actions' },
        el('button', {
          class: 'btn btn-ghost', type: 'button',
          onclick: () => { state.selected.clear(); rerender(); },
        }, 'ล้าง'),
        el('button', {
          class: 'btn', type: 'button', onclick: () => shareSummary(picked, them),
        }, icon('share', { size: 18 }), ' ส่งสรุป'),
        el('button', {
          class: 'btn btn-primary', type: 'button', onclick: () => clearSelected(picked, net, them),
        }, 'เคลียร์ที่เลือก'),
      ),
    );
  }

  /** ข้อความสรุปรายการที่เลือก ส่งต่อทาง LINE ฯลฯ ผ่านแผ่นแชร์ของ iOS (ไม่มีก็คัดลอกให้) */
  async function shareSummary(picked, them) {
    const value = netOf(picked);
    const oldestFirst = [...picked].sort((a, b) => a.date.localeCompare(b.date));
    const lines = oldestFirst.map((e) => {
      const who = e.debtor === split.me ? 'ฉันค้าง' : `${them}ค้าง`;
      // วันที่จริง ไม่ใช่ "เมื่อวาน" — อีกฝ่ายอาจอ่านวันอื่น
      return `• ${dayMonth(e.date)} ${e.name} ${formatNumber(e.remaining)} (${who})`;
    });
    const text = [`หารกัน · ${formatNumber(picked.length)} รายการ`, ...lines, `รวม: ${owesText(value, them)}`].join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('คัดลอกสรุปแล้ว — วางในแชตได้เลย');
    } catch {
      toast('ส่งสรุปไม่ได้บนเครื่องนี้');
    }
  }

  async function copyAmount(value) {
    const text = String(value);
    try {
      await navigator.clipboard.writeText(text);
      toast(`คัดลอก ${formatNumber(value)} แล้ว — วางในแอปธนาคารได้เลย`);
    } catch {
      toast(`ยอด ${formatNumber(value)} บาท`);
    }
  }

  /**
   * เคลียร์รายการที่เลือก — ถามก่อนเสมอ พร้อมสรุปยอด
   * รายการที่โอนคืนมาบางส่วนแล้ว บันทึกเป็นการโอนส่วนที่เหลือแทนการติ๊ก
   * (ไม่งั้นเงินที่โอนมาแล้วจะไปหักรายการอื่นซ้ำ) ยอดค้างจึงลดลงเท่ากับที่แสดงพอดี
   */
  async function clearSelected(picked, net, them) {
    const value = netOf(picked);
    const lines = picked.slice(0, 8).map((e) => {
      const who = e.debtor === split.me ? 'ฉันค้าง' : `${them}ค้าง`;
      return `• ${e.name} ${formatNumber(e.remaining)}${e.partly ? ` (เหลือจาก ${formatNumber(e.amount)})` : ''} · ${who}`;
    });
    if (picked.length > 8) lines.push(`และอีก ${formatNumber(picked.length - 8)} รายการ`);
    const after = Math.round((net - value) * 100) / 100;
    const ok = await confirmDialog({
      title: `เคลียร์ ${formatNumber(picked.length)} รายการ?`,
      message: `${lines.join('\n')}\n\nรวม: ${owesText(value, them)}\nหลังเคลียร์: ${after === 0 ? 'ไม่มียอดค้าง' : owesText(after, them)}`,
      confirmText: 'เคลียร์ที่เลือก',
      cancelText: 'ยังก่อน',
    });
    if (!ok) return;

    const writes = [];
    const undo = [];
    for (const e of picked) {
      if (e.partly) {
        const payment = split.draft({
          kind: 'payment', debtor: e.debtor, creditor: e.creditor, amount: e.remaining,
          name: `เคลียร์ ${e.name}`.slice(0, 200), date: entryDayISO(),
        });
        writes.push(payment);
        undo.push({ id: payment.id, before: null });
      } else {
        const before = split.byId(e.id);
        writes.push({ ...before, settled: true, settledBy: null, settledAt: null });
        undo.push({ id: e.id, before });
      }
    }
    state.selected.clear();
    split.save(writes);
    app.notifyUndoable(`เคลียร์ ${formatNumber(picked.length)} รายการแล้ว`, undo, (u) => split.revert(u));
  }

  /** ยอดสุทธิ — บวก = อีกฝ่ายค้างฉัน */
  function balanceCard(net, open, them) {
    const owedToMe = net > 0;
    const headline = net === 0 ? 'ไม่มียอดค้าง' : owedToMe ? `${them} ค้างฉัน` : `ฉันค้าง ${them}`;
    return el('section', { class: `hero-card split-balance ${net === 0 ? 'is-clear' : owedToMe ? 'is-owed' : 'is-owing'}` },
      el('p', { class: 'hero-label' }, headline),
      el('p', { class: 'hero-amount' },
        formatNumber(Math.abs(net)), el('span', { class: 'hero-unit' }, ' บาท')),
      breakdown(open, them),
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

  /** ถ้าค้างกันทั้งสองทาง บอกที่มาของยอดสุทธิ */
  function breakdown(open, them) {
    const sum = (list) => Math.round(list.reduce((t, e) => t + e.remaining, 0) * 100) / 100;
    const theyOwe = sum(open.filter((e) => e.kind === 'item' && e.creditor === split.me));
    const iOwe = sum(open.filter((e) => e.kind === 'item' && e.debtor === split.me));
    const paid = open.filter((e) => e.kind === 'payment');
    if (!(theyOwe > 0 && iOwe > 0) && paid.length === 0) return null;
    const parts = [];
    if (theyOwe > 0) parts.push(`${them}ค้าง ${formatNumber(theyOwe)}`);
    if (iOwe > 0) parts.push(`ฉันค้าง ${formatNumber(iOwe)}`);
    for (const p of paid) parts.push(`${split.nameOf(p.debtor)}โอนเกิน ${formatNumber(p.remaining)}`);
    return el('p', { class: 'split-breakdown' }, `${parts.join(' · ')} → หักลบกันแล้ว`);
  }

  function row(e, inHistory) {
    const payer = split.nameOf(e.creditor);
    const debtor = split.nameOf(e.debtor);
    const isPayment = e.kind === 'payment';
    const title = isPayment ? `${debtor} โอนคืน${e.name ? ` · ${e.name}` : ''}` : e.name;
    let sub;
    // ในประวัติไม่มีหัวข้อแยกทิศ จึงบอกทิศไว้ต้นบรรทัดรอง
    const direction = isPayment ? '' : `${e.debtor === split.me ? `ฉันค้าง ${payer}` : `${debtor} ค้างฉัน`} · `;
    if (inHistory && e.clearedBy === 'used') {
      sub = `หักยอดค้างหมดแล้ว · ${relativeDate(e.date)}`;
    } else if (inHistory) {
      sub = direction + (e.clearedBy === 'payment'
        ? `โอนคืนครบแล้ว · ${relativeDate(e.date)}`
        : `เคลียร์โดย ${split.nameOf(e.settledBy) || '—'}${e.settledAt ? ` · ${relativeDate(isoOf(e.settledAt))}` : ''}`);
    } else if (isPayment) {
      sub = `ให้ ${payer} · ${relativeDate(e.date)} · ยังไม่ได้หัก ${formatNumber(e.remaining)}`;
    } else {
      // ทิศอยู่ที่หัวข้อแล้ว บรรทัดรองจึงบอกแค่วันที่และรายละเอียดเพิ่มเติม
      const parts = [relativeDate(e.date)];
      if (e.total && e.total > e.amount) parts.push(`หารจาก ${formatNumber(e.total)}`);
      if (e.partly) parts.push(`โอนคืนแล้ว ${formatNumber(e.amount - e.remaining)} จาก ${formatNumber(e.amount)}`);
      sub = parts.join(' · ');
    }
    // อีกฝ่ายแก้รายการที่ฉันสร้าง — บอกให้รู้
    if (!inHistory && e.updatedBy !== split.me && e.createdBy === split.me && e.updatedAt > e.createdAt + 1000) {
      sub = `${sub} · แก้โดย ${split.nameOf(e.updatedBy)}`;
    }
    const isNew = !inHistory && e.updatedBy !== split.me && e.updatedAt > (state.seenAt ?? 0);
    const amountText = formatNumber(inHistory || isPayment ? e.amount : e.remaining);
    const amountLabel = isPayment ? 'ยังไม่ได้หัก' : 'บาท';

    const isSelected = !inHistory && state.selected.has(e.id);
    return el('li', { class: `tx-row split-row ${inHistory ? 'is-history' : ''} ${isSelected ? 'tx-row-selected' : ''}` },
      // วงกลม = เลือก (ยังไม่เคลียร์) — เคลียร์จริงที่แถบด้านล่าง ซึ่งถามก่อนเสมอ
      // การโอนคืนเลือกไม่ได้ — หักรายการค้างให้เองแล้วย้ายไปประวัติ
      inHistory || isPayment
        ? null
        : el('button', {
            class: 'split-tick', type: 'button',
            'aria-pressed': isSelected ? 'true' : 'false',
            'aria-label': `เลือก: ${title} ${formatMoney(e.remaining)}`,
            onclick: () => {
              if (isSelected) state.selected.delete(e.id);
              else state.selected.add(e.id);
              rerender();
            },
          }, el('span', { class: `split-tick-mark ${isSelected ? 'is-on' : ''}`, 'aria-hidden': 'true' },
            isSelected ? icon('check', { size: 16 }) : null)),
      el('button', {
        class: 'tx-button', type: 'button',
        onclick: () => (isPayment ? recordPayment(0, e) : editItem(e)),
      },
        isPayment
          ? el('span', { class: 'tile tile-md tone-teal', 'aria-hidden': 'true' }, icon('repeat'))
          : categoryTile(e.name, 'DE'),
        el('span', { class: 'tx-main' },
          el('span', { class: 'tx-name' }, title,
            isNew ? el('span', { class: 'split-new' }, 'ใหม่') : null),
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
    if (!ok) return;
    state.selected.clear();
    settle(unsettled);
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

  /** ชื่อเล่นที่ฉันใช้เรียกอีกฝ่าย — ซิงก์ทุกเครื่อง และอีกฝ่ายเห็นว่าถูกเรียกว่าอะไร */
  function editNickname() {
    const partner = split.partner;
    const original = split.pairName(partner);
    const forMe = split.nicknameForMe;
    const input = el('input', {
      class: 'input', type: 'text', value: split.myNickname ?? '', placeholder: original,
      maxlength: '30', 'aria-label': `ชื่อเล่นของ${original}`, autocomplete: 'off',
    });
    const handle = openSheet({
      title: 'ชื่อเล่น',
      body: el('div', { class: 'form' },
        el('label', { class: 'field' },
          el('span', { class: 'field-label' }, `ฉันเรียก${original}ว่า`),
          input,
          el('p', { class: 'field-hint' }, `เว้นว่างไว้ = ใช้ชื่อ “${original}” — ${original}จะเห็นชื่อนี้ด้วย`),
        ),
        el('p', { class: 'split-nick-them' }, forMe
          ? `${original}เรียกฉันว่า “${forMe}”`
          : `${original}ยังไม่ได้ตั้งชื่อเล่นให้ฉัน`),
      ),
      actions: [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: () => {
            handle.close();
            split.setNickname(input.value);
            toast(input.value.trim() ? `ตั้งชื่อเล่นว่า “${input.value.trim().slice(0, 30)}” แล้ว` : `ใช้ชื่อ “${original}” แล้ว`);
          },
        }, 'บันทึก'),
      ],
    });
    setTimeout(() => input.focus(), 150);
  }

  // ------------------------------------------------------- พิมพ์หลายบรรทัด
  const MODE_KEY = 'tet:split-name-means';

  function nameMode() {
    try {
      const v = localStorage.getItem(MODE_KEY);
      return v === 'debtor' || v === 'payer' ? v : null;
    } catch { return null; }
  }

  /** ถามครั้งแรกว่าชื่อหน้าบรรทัดหมายถึงอะไร (เก็บแยกแต่ละเครื่อง เปลี่ยนได้ภายหลัง) */
  function askNameMode(then) {
    const them = split.nameOf(split.partner);
    const pick = (mode) => {
      try { localStorage.setItem(MODE_KEY, mode); } catch { /* ใช้ได้แค่รอบนี้ */ }
      handle.close();
      then(mode);
    };
    const handle = openSheet({
      title: 'ชื่อหน้าบรรทัดหมายถึงใคร?',
      body: el('div', { class: 'form' },
        el('p', { class: 'confirm-message' }, `เวลาพิมพ์ “${them} 20 ข้าวเหนียว” หมายถึง…`),
        el('button', { class: 'btn btn-block split-mode', type: 'button', onclick: () => pick('debtor') },
          el('strong', {}, `${them} ค้างฉัน 20`), el('span', {}, 'ชื่อ = คนที่ต้องคืนเงิน')),
        el('button', { class: 'btn btn-block split-mode', type: 'button', onclick: () => pick('payer') },
          el('strong', {}, `${them} จ่ายไป 20 ฉันค้าง${them}`), el('span', {}, 'ชื่อ = คนที่ออกเงินให้')),
        el('p', { class: 'field-hint' }, 'เปลี่ยนทีหลังได้ในหน้าพิมพ์หลายบรรทัด — ตั้งแยกกันได้ในแต่ละเครื่อง'),
      ),
    });
  }

  function batchEntry() {
    const mode = nameMode();
    if (!mode) {
      askNameMode(() => batchEntry());
      return;
    }
    const me = split.me;
    const partner = split.partner;
    const them = split.nameOf(partner);
    const people = [
      { email: partner, words: [split.pairName(partner), split.myNickname].filter(Boolean) },
      { email: me, words: [split.pairName(me), split.nicknameForMe, ...SELF_WORDS].filter(Boolean) },
    ];
    const state = { date: entryDayISO(), flipped: new Set(), rows: [] };

    const area = el('textarea', {
      class: 'input textarea split-batch-input', rows: '5', 'aria-label': 'รายการ พิมพ์ทีละบรรทัด',
      placeholder: `${them} 20 ข้าวเหนียว\nฉัน 30 ค่ารถ\n${them} 300 หมูกระทะ หาร\n${them} โอน 50`,
      autocapitalize: 'off', spellcheck: 'false',
    });
    const cards = el('div', { class: 'split-batch-cards', role: 'status' });
    const top = el('div', { class: 'split-batch-top' });
    const saveButton = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => saveBatch() }, 'บันทึก');
    let timer = null;
    area.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(paint, 180);
    });

    const flip = (row) => (state.flipped.has(row.raw) && row.kind === 'item'
      ? { ...row, debtor: row.creditor, creditor: row.debtor }
      : row);

    function paint() {
      const m = nameMode() ?? 'debtor';
      state.rows = parseSplitText(area.value, { people, mode: m, date: state.date, today: todayISO() }).map(flip);
      replace(top,
        el('button', {
          class: 'picker-field', type: 'button',
          onclick: () => openDatePicker({ value: state.date, onSelect: (iso) => { state.date = iso; paint(); } }),
        },
          el('span', { class: 'field-label' }, 'วันที่'),
          el('span', { class: 'picker-field-value' }, relativeDate(state.date)),
          icon('chevronRight', { size: 18, cls: 'picker-field-mark' }),
        ),
        el('div', { class: 'split-batch-mode' },
          el('span', {}, m === 'debtor' ? 'ชื่อหน้าบรรทัด = คนที่ค้าง' : 'ชื่อหน้าบรรทัด = คนที่จ่ายไป'),
          el('button', {
            class: 'btn btn-small btn-ghost', type: 'button',
            onclick: () => {
              try { localStorage.setItem(MODE_KEY, m === 'debtor' ? 'payer' : 'debtor'); } catch { /* ไม่เป็นไร */ }
              state.flipped.clear();
              paint();
            },
          }, 'สลับ'),
        ),
      );
      replace(cards, state.rows.map((row) => batchCard(row)));
      const good = state.rows.filter((r) => r.ok).length;
      saveButton.textContent = good > 0 ? `บันทึก ${formatNumber(good)} รายการ` : 'บันทึก';
      saveButton.disabled = good === 0;
    }

    function batchCard(row) {
      if (!row.ok) {
        const why = {
          who: `ไม่รู้ว่าใคร — ขึ้นต้นด้วยชื่อ เช่น “${them}” หรือ “ฉัน”`,
          amount: 'ไม่พบยอดเงิน',
          what: 'ยังไม่ได้บอกว่าจ่ายค่าอะไร',
        }[row.error] ?? 'อ่านไม่ออก';
        return el('div', { class: 'split-batch-card is-bad' },
          el('span', { class: 'split-batch-raw' }, row.raw),
          el('span', { class: 'split-batch-why' }, why),
        );
      }
      const debtor = row.debtor === me ? 'ฉัน' : split.nameOf(row.debtor);
      const creditor = row.creditor === me ? 'ฉัน' : split.nameOf(row.creditor);
      const headline = row.kind === 'payment'
        ? `${debtor} โอนคืนให้${creditor} ${formatMoney(row.amount)}`
        : `${row.debtor === me ? `ฉันค้าง ${creditor}` : `${debtor} ค้างฉัน`} ${formatMoney(row.amount)}`;
      const meta = [
        row.kind === 'item' ? row.name : null,
        row.half ? `หารครึ่งจาก ${formatNumber(row.total)}` : null,
        row.date !== state.date ? relativeDate(row.date) : null,
      ].filter(Boolean).join(' · ');
      return el('div', { class: 'split-batch-card' },
        el('div', { class: 'split-batch-text' },
          el('strong', {}, headline),
          meta ? el('span', {}, meta) : null,
        ),
        row.kind === 'item'
          ? el('button', {
              class: 'round-btn split-flip', type: 'button', 'aria-label': `สลับว่าใครค้างใคร: ${row.raw}`,
              onclick: () => {
                if (state.flipped.has(row.raw)) state.flipped.delete(row.raw);
                else state.flipped.add(row.raw);
                paint();
              },
            }, icon('repeat', { size: 18 }))
          : null,
      );
    }

    async function saveBatch() {
      const good = state.rows.filter((r) => r.ok);
      const bad = state.rows.length - good.length;
      if (good.length === 0) return;
      if (bad > 0) {
        const ok = await confirmDialog({
          title: `ข้าม ${formatNumber(bad)} บรรทัดที่อ่านไม่ออก?`,
          message: `บันทึกเฉพาะ ${formatNumber(good.length)} รายการที่อ่านได้`,
          confirmText: 'บันทึกที่อ่านได้',
          cancelText: 'กลับไปแก้',
        });
        if (!ok) return;
      }
      const entries = good.map((r) => split.draft({
        kind: r.kind, debtor: r.debtor, creditor: r.creditor, amount: r.amount,
        total: r.total, name: r.name, date: r.date,
      }));
      handle.close();
      split.save(entries);
      app.notifyUndoable(`บันทึกแล้ว ${formatNumber(entries.length)} รายการ`,
        entries.map((e) => ({ id: e.id, before: null })), (u) => split.revert(u));
    }

    const handle = openSheet({
      title: 'พิมพ์หลายบรรทัด',
      fullHeight: true,
      body: el('div', { class: 'form split-batch' },
        area,
        el('p', { class: 'field-hint' }, 'บรรทัดละรายการ: ชื่อ ยอด สิ่งที่จ่าย · ต่อท้าย “หาร” = หารครึ่ง · “โอน 50” = โอนคืน · ใส่ “เมื่อวาน” ได้'),
        top,
        cards,
      ),
      actions: [
        el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ยกเลิก'),
        saveButton,
      ],
    });
    paint();
    setTimeout(() => area.focus(), 150);
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

/** "20 ต.ค." */
function dayMonth(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${monthNameShort(m)}`;
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
