// ข้อมูลตัวอย่างสำหรับพรีวิว — สร้างขึ้นทั้งหมด ไม่มีข้อมูลจริงของใคร
//
// รูปร่างเลียนแบบข้อมูลจริงที่นำเข้าจาก Excel: รายการส่วนใหญ่ไม่ได้เลือกประเภท
// ชื่อซ้ำ ๆ แบบชีวิตประจำวัน มีบางรายการไม่ระบุมูลค่า และมีวันที่ลืมบันทึก
// ผูกกับ "วันนี้" ตอนเปิดพรีวิว เพื่อให้หน้าวันมีรายการเสมอ ไม่เก่าไปตามเวลา
// สุ่มแบบกำหนดค่าเริ่มต้นไว้ จึงได้ชุดเดิมทุกครั้ง

const ITEMS = [
  ['ข้าวต้มหมู', 'ค่าอาหาร', 25, 45], ['ก๋วยเตี๋ยว', 'ค่าอาหาร', 40, 60], ['ข้าวแกง', 'ค่าอาหาร', 35, 60],
  ['ข้าวมันไก่', 'ค่าอาหาร', 45, 60], ['ผัดกะเพรา', 'ค่าอาหาร', 50, 70], ['ส้มตำ', 'ค่าอาหาร', 40, 80],
  ['ไป', 'ค่าเดินทาง', 20, 45], ['กลับ', 'ค่าเดินทาง', 20, 45], ['วิน', 'ค่าเดินทาง', 10, 30],
  ['รถไฟฟ้า', 'ค่าเดินทาง', 30, 60], ['ชานม', 'ค่าเครื่องดื่ม', 35, 65], ['กาแฟ', 'ค่าเครื่องดื่ม', 40, 85],
  ['ชาเขียว', 'ค่าเครื่องดื่ม', 20, 50], ['น้ำเปล่า', 'ค่าเครื่องดื่ม', 7, 15], ['ขนมปัง', 'ค่าของหวาน', 15, 45],
  ['เค้ก', 'ค่าของหวาน', 45, 95], ['แอปเปิ้ล', 'ค่าผลไม้', 20, 45], ['มะม่วง', 'ค่าผลไม้', 30, 60],
  ['เซเว่น', null, 30, 120], ['ของใช้', 'ค่าของใช้ในบ้าน', 50, 300], ['ยาสระผม', 'ค่าของใช้ในบ้าน', 89, 189],
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {string} today  'YYYY-MM-DD' ตามเวลาเครื่อง
 * @returns ข้อมูลในรูปแบบไฟล์สำรองของแอป
 */
export function makeDemoData(today) {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let n = 0;
  const id = () => `demo-${(++n).toString(36)}-${Math.floor(rnd() * 1e9).toString(36)}`;

  const [ty, tm, td] = today.split('-').map(Number);
  const tx = [];
  const add = (date, name, type, amount, kind, group) => {
    const at = new Date(`${date}T09:00:00`).getTime() + Math.floor(rnd() * 12 * 3600e3);
    tx.push({ id: id(), kind, name, amount, type, group, date, createdAt: at, updatedAt: at, deleted: false });
  };

  // 10 เดือนล่าสุด จนถึงวันนี้
  for (let back = 9; back >= 0; back--) {
    const d = new Date(ty, tm - 1 - back, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${pad(m)}`;
    const last = back === 0 ? td : new Date(y, m, 0).getDate();
    const day = (n) => `${key}-${pad(Math.min(n, last))}`;

    add(day(1), 'เงินเดือน', 'เงินเดือน', 18000, 'income', 'IN');
    if (rnd() < 0.5) add(day(10 + Math.floor(rnd() * 15)), 'งานเสริม', 'รายได้เสริม', 500 + Math.floor(rnd() * 8) * 250, 'income', 'IN');
    if (last >= 5) add(day(5), 'ค่าเน็ต', rnd() < 0.5 ? 'ค่าอินเทอร์เน็ต' : null, 399, 'expense', 'SD');
    if (last >= 10) add(day(10), 'ค่าไฟ', rnd() < 0.5 ? 'ค่าไฟฟ้า' : null, 700 + Math.floor(rnd() * 600), 'expense', 'SD');
    if (last >= 15) add(day(15), 'ค่าโทรศัพท์', rnd() < 0.5 ? 'ค่าโทรศัพท์' : null, 299, 'expense', 'SD');
    if (last >= 25 && rnd() < 0.3) add(day(25), 'ออมฉุกเฉิน', 'เงินออมฉุกเฉิน', 1000, 'expense', 'SV');

    // สองเดือนที่ลงประเภทไว้ครบ ที่เหลือแทบไม่ได้ลง — เหมือนข้อมูลจริง
    const typedRate = back === 9 || back === 5 ? 0.85 : 0.08;
    for (let dd = 1; dd <= last; dd++) {
      if (dd !== td && rnd() < 0.08) continue; // วันที่ลืมบันทึก (วันนี้มีรายการเสมอ)
      const count = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < count; i++) {
        const [name, type, lo, hi] = pick(ITEMS);
        const amount = rnd() < 0.03 ? null : Math.round((lo + rnd() * (hi - lo)) * 2) / 2;
        const keepType = rnd() < typedRate ? type : null;
        add(`${key}-${pad(dd)}`, name, keepType, amount, 'expense', keepType === 'ค่าของใช้ในบ้าน' ? 'SD' : 'DE');
      }
    }
  }

  const first = new Date(ty, tm - 10, 1);
  return {
    app: 'thai-expense-tracker',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      budgets: { defaults: { 'ค่าอาหาร': 4500, 'ค่าเดินทาง': 1500, 'ค่าเครื่องดื่ม': 800 }, months: {} },
      openingBalances: { [`${first.getFullYear()}-${pad(first.getMonth() + 1)}`]: 5000 },
    },
    transactions: tx,
  };
}
