// Keeps the app itself (not the music) available without internet. Songs and pictures are kept by the app in IndexedDB.
const VERSION = 'v1';
const CACHE = `nsm-shell-${VERSION}`;
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/util.js', 'js/phonetic.js', 'js/setupcode.js', 'js/github.js', 'js/store.js', 'js/library.js', 'js/upload.js', 'js/ui.js', 'js/state.js',
  'js/views/guide.js', 'js/views/songs.js', 'js/views/albums.js', 'js/views/todo.js', 'js/views/add.js', 'js/views/editor.js', 'js/views/viewer.js', 'js/views/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('nsm-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // GitHub calls are never intercepted
  // Fresh copy when online (so an update shows up at once); the saved copy when not.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
