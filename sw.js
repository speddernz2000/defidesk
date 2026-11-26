// Offline-friendly app shell. Only same-origin files are cached; all live data (prices, pools, AI) always goes to the network.
const CACHE = 'defi-tracker-v3';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/util.js', 'js/api.js', 'js/math.js', 'js/charts.js', 'js/state.js', 'js/tokens.js',
  'js/pools.js', 'js/calc.js', 'js/wallet.js', 'js/paper.js', 'js/ai.js', 'js/main.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;           // never touch API calls
  e.respondWith(caches.open(CACHE).then(async (cache) => {                       // network first (always the newest version), cache as the offline fallback
    try { const res = await fetch(req, { cache: 'no-cache' }); if (res.ok) cache.put(req, res.clone()); return res; }
    catch { return (await cache.match(req)) || (await cache.match('index.html')); }
  }));
});
