/* MedyaAtlas service worker — sürümle değişen cache.
 * Placeholders: __MEDYAATLAS_VERSION__ (CI/build damgası)
 */
const APP_VERSION = '__MEDYAATLAS_VERSION__';
const CACHE_NAME = 'medyaatlas-v' + APP_VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './app_version.js',
  './update.js',
  './favicon.png',
  './favicon-32.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.ok) await cache.put(url, res);
          } catch (_) {}
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('medyaatlas-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'SKIP_WAITING' || event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept') &&
      request.headers.get('accept').includes('text/html'))
  );
}

function isVersionJson(url) {
  return /\/version\.json(\?|$)/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // Yalnızca aynı origin.
  if (url.origin !== self.location.origin) return;

  // HTML + version.json → network-first (yeni sürüm çabuk görünsün).
  if (isNavigationRequest(request) || isVersionJson(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Diğer aynı-origin asset’ler → stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isNavigationRequest(request)) {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw _;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  throw new Error('offline');
}
