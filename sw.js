/* SCENEDROME Hub · service worker: installable app, offline shell, push notifications */
const CACHE = 'sd-hub-v3';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './assets/logo.png', './assets/s.png', './assets/bg.jpg', './assets/chat-doodles.svg', './assets/app/icon-192.png', './assets/app/badge-mono.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// network first (always the latest Hub), cached copy when offline
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const fresh = e.request.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/');
  e.respondWith((fresh ? fetch(u.href, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request)).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'SCENEDROME Hub';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, { body: d.body || '', icon: 'assets/app/icon-192.png', badge: 'assets/app/badge-mono.png', tag: d.tag || undefined, renotify: !!d.tag, data: { link: d.link || null } }),
    self.navigator && self.navigator.setAppBadge && d.badge ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || null;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => new URL(x.url).origin === location.origin);
    if (c) { c.postMessage({ type: 'go', link }); return c.focus(); }
    return self.clients.openWindow('./' + (link ? '?go=' + encodeURIComponent(JSON.stringify(link)) : ''));
  }));
});
