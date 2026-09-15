// service worker แบบเรียบง่าย — แคชไฟล์ของแอปไว้ให้เปิดได้ตอนออฟไลน์
// ข้อมูลของผู้ใช้อยู่ใน localStorage ไม่ได้ผ่านที่นี่

const CACHE = 'tet-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/dom.js',
  './js/format.js',
  './js/model.js',
  './js/parser.js',
  './js/storage.js',
  './js/store.js',
  './js/charts.js',
  './js/ui.js',
  './js/backup.js',
  './js/screens/home.js',
  './js/screens/log.js',
  './js/screens/month.js',
  './js/screens/year.js',
  './js/screens/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // ไฟล์ที่โหลดไม่ได้ไม่ควรทำให้ติดตั้งล้มทั้งชุด
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // หน้าเว็บ: ลองเครือข่ายก่อนเพื่อให้ได้ของใหม่ ถ้าออฟไลน์ค่อยใช้แคช
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html'))),
    );
    return;
  }

  // ไฟล์อื่น: ใช้แคชก่อนเพื่อความเร็ว แล้วอัปเดตแคชไว้ใช้คราวหน้า
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit ?? network;
    }),
  );
});
