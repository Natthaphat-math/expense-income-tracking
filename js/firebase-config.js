// ตั้งค่า Firebase สำหรับการซิงก์ข้ามเครื่อง (เฟส 2)
//
// ค่าพวกนี้เป็น "ตัวระบุโปรเจกต์" ไม่ใช่ความลับ — ทุกเว็บที่ใช้ Firebase
// ฝั่งเบราว์เซอร์ต้องส่งค่าเหล่านี้ไปกับทุกคำขออยู่แล้ว ใครเปิดหน้าเว็บก็อ่านได้
// สิ่งที่กันข้อมูลจริง ๆ คือ Firestore Security Rules (docs/firestore.rules)
// ส่วนการจำกัด API key ใน Google Cloud Console เป็นการกันคนอื่นเอา key ไปใช้
// บนเว็บตัวเอง ไม่ใช่การกันคนเข้าถึงข้อมูล

export const firebaseConfig = {
  apiKey: 'AIzaSyB6VdTEA1WIYGR2X5s4JKT05ekabuwiBww',
  authDomain: 'expense-income-tracking.firebaseapp.com',
  projectId: 'expense-income-tracking',
  storageBucket: 'expense-income-tracking.firebasestorage.app',
  messagingSenderId: '293057884108',
  appId: '1:293057884108:web:34b731e77a44b1f0e13769',
};

/**
 * รุ่นของ Firebase SDK ที่โหลดจาก CDN
 * ตรึงรุ่นไว้ เพื่อให้ service worker แคชไฟล์ชุดเดิมได้แน่นอน
 */
export const FIREBASE_SDK_VERSION = '10.14.1';

/**
 * อีเมลเจ้าของ (ไม่บังคับ)
 * ใส่ไว้เพื่อเตือนตั้งแต่หน้าจอว่าพิมพ์อีเมลผิด — ไม่ใช่การรักษาความปลอดภัย
 * ตัวที่กันจริงคือกฎใน Firestore ซึ่งบังคับที่ฝั่งเซิร์ฟเวอร์
 * ปล่อยเป็น null ได้ ถ้าไม่อยากใส่อีเมลลงใน repo สาธารณะ
 */
export const OWNER_EMAIL = null;

/** เปิด/ปิดการซิงก์ทั้งระบบ ถ้าเป็น false แอปจะทำงานในเครื่องอย่างเดียว */
export const SYNC_ENABLED = true;
