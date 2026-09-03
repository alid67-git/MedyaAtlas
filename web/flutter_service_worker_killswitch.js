// MediaAtlas kill-switch: eski Flutter SW cache'ini temizle, yeni yola git.
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try { await self.clients.claim(); } catch (e) {}
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      var clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      var url = 'https://alid67-git.github.io/MedyaAtlas/?t=' + Date.now();
      await Promise.all(clients.map(function (c) {
        if ('navigate' in c) return c.navigate(url);
        return null;
      }));
    } catch (e) {}
  })());
});

self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request));
});
