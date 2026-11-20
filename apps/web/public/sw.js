// Service worker chi luu tam nhung gi an toan de dung lai:
//  - /faq, /guide: trang tinh, cho phep xem lai khi mang yeu (uu tien mang, du phong ban luu).
//  - /_next/static/: tep da bam ten theo noi dung, khong doi.
// Tuyet doi khong luu trang rieng tu (/my-tickets, /checkout, /admin, /organizer...), vi ma QR
// doi moi 30 giay va noi dung thuoc ve tung tai khoan. Moi yeu cau khac di thang qua mang.
const CACHE_VERSION = "tickethub-pwa-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

const PRECACHE_PAGES = ["/faq", "/guide"];
const CACHEABLE_PAGES = new Set(PRECACHE_PAGES);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(PRECACHE_PAGES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Xoa moi cache cu, ke ca cache v2 da tung luu /my-tickets.
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.status === 200) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (CACHEABLE_PAGES.has(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(url.pathname);
        }),
    );
  }
});
