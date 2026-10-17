// จุดเริ่มของไฟล์พรีวิว: ใส่ข้อมูลตัวอย่างก่อน แล้วค่อยเปิดแอป
// ลำดับ import สำคัญ — preview-seed ต้องรันจบก่อน main.js เริ่มโหลดข้อมูล
import { seedDemo } from './preview-seed.js';
import '../js/main.js';
import { el } from '../js/dom.js';
import { confirmDialog, toast } from '../js/ui.js';

function demoStrip() {
  const strip = el('div', { class: 'demo-strip', role: 'note' },
    el('span', { class: 'demo-strip-text' }, 'พรีวิว · ข้อมูลตัวอย่าง ไม่ใช่ข้อมูลจริง'),
    el('button', {
      class: 'demo-strip-reset', type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'เริ่มข้อมูลตัวอย่างใหม่?',
          message: 'รายการที่เพิ่มหรือแก้ไขในพรีวิวนี้จะถูกล้าง แล้วกลับเป็นข้อมูลตัวอย่างชุดเดิม',
          confirmText: 'เริ่มใหม่',
        });
        if (!ok) return;
        seedDemo(true);
        await window.__app.store.load();
        window.__app.go('day', { reset: true });
        toast('เริ่มข้อมูลตัวอย่างใหม่แล้ว');
      },
    }, 'เริ่มใหม่'),
  );
  document.body.appendChild(strip);
}
demoStrip();
