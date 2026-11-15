const VERSION = 'qamus-v13';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'merge.js', 'sync.js', 'vocab.js', 'study.js', 'manifest.webmanifest', 'icon-512.png',
  'data/index.json', 'data/hw.json', 'data/morph.json', 'data/wikt.json', 'data/lane/roots.json'];

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the HTTP cache so a new VERSION never stores stale copies.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isFont = url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com');
  if (url.origin !== location.origin && !isFont) return;
  // cache-first; refresh in background for same-origin app files
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
