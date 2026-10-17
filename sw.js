const CACHE = 'jikenbo-shell-v2';
const SHELL = ['./','./index.html','./style.css','./app.js','./model.js','./config.js','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('jikenbo-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const allowed = SHELL.map(x => new URL(x, self.registration.scope).pathname);
  const path = new URL(event.request.url).pathname;
  if (!allowed.includes(path)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(async () => await caches.match(event.request) || (event.request.mode === 'navigate' ? await caches.match(new URL('./index.html',self.registration.scope)) : Response.error())));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const base = self.registration.scope;
  const target = new URL(data.url || './', base);
  const safeUrl = target.origin === self.location.origin && target.pathname.startsWith(new URL(base).pathname) ? target.href : base;
  event.waitUntil(self.registration.showNotification(data.title || '今日はひとこと事件ある？ 👻', {
    body: data.body || 'あれば一行。なければスルーでOK。',
    icon: new URL('./icon-192.png', base).href,
    badge: new URL('./icon-192.png', base).href,
    tag: data.tag || 'hitokoto-reminder',
    data: { url: safeUrl }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        client.postMessage({ type: 'open-incident', url: target });
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
