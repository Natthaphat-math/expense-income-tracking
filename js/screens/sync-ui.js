// ส่วนติดต่อผู้ใช้สำหรับการซิงก์ข้อมูล — อยู่ในหน้าตั้งค่า

import { el, replace } from '../dom.js';
import { openSheet, confirmDialog, toast } from '../ui.js';
import { shortDate } from '../format.js';
import {
  sendSignInLink, completeSignIn, signOut, recallEmail, isSignInLink,
} from '../remote.js';
import { friendlyError } from '../sync.js';
import { SYNC_ENABLED, OWNER_EMAIL } from '../firebase-config.js';

const STATUS_TEXT = {
  disabled: 'ปิดการซิงก์อยู่',
  idle: 'ยังไม่ได้เข้าสู่ระบบ',
  syncing: 'กำลังซิงก์…',
  ok: 'ซิงก์แล้ว',
  error: 'ซิงก์ไม่สำเร็จ',
};

export function syncCard(app, rerender) {
  if (!SYNC_ENABLED) return null;
  const sync = app.sync;
  if (!sync) return null;

  const lastSynced = sync.lastSyncedAt;

  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-title' }, 'ซิงก์ข้อมูล'),
      el('span', { class: `sync-badge sync-${sync.status}` }, STATUS_TEXT[sync.status] ?? sync.status),
    ),

    sync.signedIn
      ? el('div', {},
          el('p', { class: 'field-hint' }, `เข้าสู่ระบบด้วย ${sync.email ?? '—'}`),
          lastSynced
            ? el('p', { class: 'field-hint' }, `ซิงก์ล่าสุด ${shortDate(lastSynced.slice(0, 10))}`)
            : null,
          sync.lastError ? el('p', { class: 'sync-error' }, sync.lastError) : null,
          el('button', {
            class: 'btn btn-primary btn-block', type: 'button',
            onclick: async () => {
              const result = await sync.syncNow();
              rerender();
              if (result) toast(`ซิงก์แล้ว — รับมา ${result.pulled} ส่งไป ${result.pushed}`);
              else toast(sync.lastError ?? 'ซิงก์ไม่สำเร็จ');
            },
          }, 'ซิงก์เดี๋ยวนี้'),
          el('button', {
            class: 'btn btn-block', type: 'button',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'ออกจากระบบ?',
                message: 'ข้อมูลในเครื่องยังอยู่ครบ แต่จะหยุดซิงก์กับเครื่องอื่นจนกว่าจะเข้าสู่ระบบใหม่',
                confirmText: 'ออกจากระบบ',
              });
              if (!ok) return;
              await signOut();
              toast('ออกจากระบบแล้ว');
              rerender();
            },
          }, 'ออกจากระบบ'),
        )
      : el('div', {},
          el('p', { class: 'field-hint' },
            'เข้าสู่ระบบเพื่อสำรองข้อมูลขึ้นคลาวด์และใช้ร่วมกันหลายเครื่อง ไม่ต้องตั้งรหัสผ่าน'),
          sync.lastError ? el('p', { class: 'sync-error' }, sync.lastError) : null,
          el('button', {
            class: 'btn btn-primary btn-block', type: 'button',
            onclick: () => openSignInSheet(app, rerender),
          }, 'เข้าสู่ระบบด้วยอีเมล'),
        ),

    el('p', { class: 'field-hint' },
      'ข้อมูลยังเก็บอยู่ในเครื่องเสมอ ใช้งานได้ตามปกติแม้ไม่มีเน็ต การซิงก์เป็นตัวเสริม'),
  );
}

function openSignInSheet(app, rerender) {
  const emailInput = el('input', {
    class: 'input', type: 'email', inputmode: 'email',
    placeholder: 'อีเมลของคุณ', 'aria-label': 'อีเมล',
    autocomplete: 'email', autocapitalize: 'off', autocorrect: 'off',
    value: recallEmail() || OWNER_EMAIL || '',
  });

  const linkInput = el('textarea', {
    class: 'input textarea', rows: '3',
    placeholder: 'วางลิงก์จากอีเมลที่นี่',
    'aria-label': 'ลิงก์จากอีเมล',
    autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
  });

  const message = el('p', { class: 'field-hint' });

  const setBusy = (busy, text) => {
    replace(message, text ?? '');
    message.className = busy ? 'field-hint' : 'field-hint';
  };

  const requestLink = async () => {
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
      replace(message, 'กรุณากรอกอีเมลให้ถูกต้อง');
      return;
    }
    setBusy(true, 'กำลังส่งลิงก์…');
    try {
      await sendSignInLink(email);
      replace(message, `ส่งลิงก์ไปที่ ${email} แล้ว — เปิดอีเมล คัดลอกลิงก์ แล้วนำมาวางในช่องด้านล่าง`);
    } catch (err) {
      replace(message, friendlyError(err));
    }
  };

  const useLink = async () => {
    const link = linkInput.value.trim();
    if (!link) {
      replace(message, 'ยังไม่ได้วางลิงก์');
      return;
    }
    setBusy(true, 'กำลังเข้าสู่ระบบ…');
    try {
      await completeSignIn(link, emailInput.value.trim());
      handle.close();
      toast('เข้าสู่ระบบแล้ว');
      await afterSignIn(app, rerender);
    } catch (err) {
      replace(message, friendlyError(err));
    }
  };

  const handle = openSheet({
    title: 'เข้าสู่ระบบ',
    fullHeight: true,
    body: el('div', { class: 'form' },
      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, 'อีเมล'),
        emailInput,
      ),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: requestLink },
        'ส่งลิงก์เข้าสู่ระบบ'),
      message,

      el('div', { class: 'signin-divider' }, 'แล้วทำต่อที่นี่'),

      el('label', { class: 'field' },
        el('span', { class: 'field-label' }, 'ลิงก์จากอีเมล'),
        linkInput,
      ),
      el('button', { class: 'btn btn-block', type: 'button', onclick: useLink },
        'เข้าสู่ระบบด้วยลิงก์นี้'),

      el('div', { class: 'note-box' },
        el('strong', {}, 'ทำไมต้องคัดลอกลิงก์มาวาง'),
        el('p', {},
          'บน iPhone การกดลิงก์ในอีเมลจะเปิดใน Safari ซึ่งแยกที่เก็บข้อมูลกับแอปบนหน้าจอโฮม ',
          'ถ้ากดลิงก์ตรง ๆ จะกลายเป็นเข้าสู่ระบบใน Safari ไม่ใช่ในแอปนี้'),
        el('p', {},
          'ให้กดค้างที่ลิงก์ในอีเมล เลือก “คัดลอก” แล้วกลับมาวางที่ช่องด้านบน ',
          'การเข้าสู่ระบบจะเกิดขึ้นในแอปนี้จริง ๆ'),
      ),
    ),
    actions: [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => handle.close() }, 'ปิด'),
    ],
  });
}

async function afterSignIn(app, rerender) {
  const sync = app.sync;
  const localCount = app.store.active.length;

  const result = await sync.syncNow();
  rerender();

  if (!result) {
    toast(sync.lastError ?? 'ซิงก์ไม่สำเร็จ');
    return;
  }

  // เครื่องนี้มีข้อมูลอยู่แล้วแต่คลาวด์ยังว่าง — เสนอให้ส่งขึ้นไปทั้งหมด
  if (localCount > 0 && result.pulled === 0 && result.pushed === 0) {
    const ok = await confirmDialog({
      title: 'ส่งข้อมูลขึ้นคลาวด์?',
      message: `เครื่องนี้มี ${localCount.toLocaleString('th-TH')} รายการ แต่บนคลาวด์ยังไม่มีอะไร ต้องการส่งขึ้นไปทั้งหมดไหม`,
      confirmText: 'ส่งขึ้นไป',
    });
    if (ok) {
      try {
        await sync.pushAll();
        toast('ส่งข้อมูลขึ้นคลาวด์แล้ว');
      } catch (err) {
        toast(friendlyError(err));
      }
      rerender();
    }
    return;
  }

  toast(`ซิงก์แล้ว — รับมา ${result.pulled} ส่งไป ${result.pushed}`);
}

/**
 * ถ้าเปิดแอปมาจากลิงก์ในอีเมลโดยตรง ให้เข้าสู่ระบบให้เลย
 * (กรณีเปิดใน Safari ปกติ ไม่ใช่แอปบนหน้าจอโฮม)
 */
export async function handleSignInLinkOnLoad(app) {
  if (!SYNC_ENABLED) return false;
  if (!location.href.includes('apiKey=')) return false; // เลี่ยงการโหลด SDK โดยไม่จำเป็น

  try {
    if (!(await isSignInLink(location.href))) return false;
    const email = recallEmail();
    if (!email) return false;

    await completeSignIn(location.href, email);
    // ล้างพารามิเตอร์ออกจาก URL ไม่ให้ลิงก์ค้างอยู่ในประวัติเบราว์เซอร์
    history.replaceState(null, '', location.pathname);
    toast('เข้าสู่ระบบแล้ว');
    await app.sync?.syncNow();
    return true;
  } catch (err) {
    console.warn('เข้าสู่ระบบจากลิงก์ไม่สำเร็จ', err);
    toast(friendlyError(err));
    return false;
  }
}
