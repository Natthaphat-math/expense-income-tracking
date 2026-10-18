// อ่านสลิปจากรูปในเครื่อง — ทุกอย่างทำในเบราว์เซอร์ รูปไม่ถูกส่งออกไปไหน
//
// ใช้ไฟล์จาก vendor/ ของเว็บเราเอง (ไม่โหลดจาก CDN ภายนอก) และโหลดเฉพาะตอนใช้งานจริง
// ครั้งแรกดาวน์โหลดราว 5 MB จากนั้น service worker เก็บไว้ ใช้ออฟไลน์ได้

import { parseSlip } from './slip-parse.js';

const TESSERACT = 'vendor/tesseract-5.1.1/';
const JSQR = 'vendor/jsqr-1.4.0/jsQR.min.js';

/** รูปใหญ่กว่านี้ย่อลงก่อนอ่าน — สลิปจากมือถือกว้างราว 1,100–1,300 px อ่านได้ดีอยู่แล้ว */
const MAX_WIDTH = 1300;

function vendorURL(path) {
  return new URL(path, document.baseURI).href;
}

const loaded = new Map();
function loadScript(path) {
  if (!loaded.has(path)) {
    loaded.set(path, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = vendorURL(path);
      script.onload = resolve;
      script.onerror = () => {
        loaded.delete(path);
        reject(new Error(`โหลด ${path} ไม่สำเร็จ`));
      };
      document.head.appendChild(script);
    }));
  }
  return loaded.get(path);
}

/** ลายนิ้วมือของไฟล์ — ไฟล์เดิมเลือกซ้ำได้ค่าเดิมเสมอ */
async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* ลองอีกวิธี */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * เตรียมรูปให้ OCR อ่านง่าย: ใช้ค่าสีที่เข้มที่สุดของแต่ละจุด (ตัวหนังสือสีเขียว/ฟ้าจะกลายเป็นสีเข้ม)
 * แล้วดึงความต่างให้ชัด พื้นลายจาง ๆ หายไป
 */
function preprocess(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    let v = Math.min(px[i], px[i + 1], px[i + 2]);
    v = v > 200 ? 255 : v < 120 ? 0 : ((v - 120) * 255) / 80;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * เปิดตัวอ่านสลิป — โหลดไฟล์ที่จำเป็นแล้วคืนฟังก์ชัน read() ที่ใช้ซ้ำได้หลายรูป
 * @param {(info: {stage: string, progress?: number}) => void} onStatus
 */
export async function openSlipReader(onStatus = () => {}) {
  onStatus({ stage: 'loading' });
  await Promise.all([loadScript(`${TESSERACT}tesseract.min.js`), loadScript(JSQR)]);
  const worker = await globalThis.Tesseract.createWorker('tha', 1, {
    workerPath: vendorURL(`${TESSERACT}worker.min.js`),
    corePath: vendorURL(TESSERACT),
    langPath: vendorURL(TESSERACT),
    gzip: true,
    // สร้าง worker จากไฟล์บนเว็บเราตรง ๆ (ไม่ใช่ blob) เพื่อให้ service worker แคชไฟล์ที่มันโหลดได้
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'loading language traineddata') onStatus({ stage: 'loading', progress: m.progress });
    },
  });
  onStatus({ stage: 'ready' });

  return {
    /** อ่านสลิปหนึ่งรูป → ร่างรายการ + ข้อมูลกันซ้ำ */
    async read(file) {
      const buffer = await file.arrayBuffer();
      const hash = await sha256(buffer);
      const image = await decodeImage(file);
      const scale = Math.min(1, MAX_WIDTH / image.width);
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      image.close?.();

      const pixels = ctx.getImageData(0, 0, width, height);
      const code = globalThis.jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });

      preprocess(ctx, width, height);
      const { data } = await worker.recognize(canvas);
      return { hash, qr: code?.data ?? null, ...parseSlip(data.text, code?.data ?? null) };
    },
    close() {
      return worker.terminate();
    },
  };
}
