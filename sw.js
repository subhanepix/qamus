// Qamus Service Worker — split shell vs. dictionary data caches so UI deploys
// never force devices to re-download ~14 MB of static lexicon JSON.
const PREFIX = 'qamus-';
const SHELL_CACHE = PREFIX + 'shell-v31';
const DATA_CACHE = PREFIX + 'data-v1';

const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'engine.js',
  'particles.js',
  'tour.js',
  'merge.js',
  'sync.js',
  'manifest.webmanifest',
  'icon-512.png',
];

const DATA = [
  'data/index.json',
  'data/hw/index.json',
  'data/morph.json',
  'data/wikt.json',
  'data/lane/roots.json',
  'data/mufradat/roots.json',
  'data/mukhtar/roots.json',
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))),
    caches.open(DATA_CACHE).then(async c => {
      // Only fetch data files not already cached in DATA_CACHE
      await Promise.all(DATA.map(async u => {
        const hit = await c.match(u);
        if (!hit) await c.add(new Request(u, { cache: 'reload' }));
      }));
    }),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE]);
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isFont = url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com');
  if (url.origin !== location.origin && !isFont) return;

  const isData = url.origin === location.origin && url.pathname.includes('/data/');
  const cacheName = isData ? DATA_CACHE : SHELL_CACHE;

  // Cache-first; refresh shell assets in the background so updates pick up cleanly.
  e.respondWith(caches.open(cacheName).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    if (hit && isData) return hit; // Dictionary shards are immutable per DATA_CACHE version
    const net = fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});
