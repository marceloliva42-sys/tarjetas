// Guarda la app en el celular para que abra sin internet
const CACHE = 'mis-tarjetas-v2';
const ARCHIVOS = ['./', './index.html', './style.css', './app.js', './engine.js', './config.js',
  './vendor/supabase.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // la nube va directo
  // primero la red (para recibir mejoras), si no hay internet la copia guardada
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

// Avisos del celular
self.addEventListener('push', e => {
  let d = { title: 'Mis Tarjetas', body: '' };
  try { d = Object.assign(d, e.data.json()); } catch (_) { }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return self.clients.openWindow(e.notification.data && e.notification.data.url || './');
  }));
});
