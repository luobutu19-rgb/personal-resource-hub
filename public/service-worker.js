const VERSION = 'rh-v45';
const SHELL_CACHE = `shell-${VERSION}`;
const MEDIA_CACHE = 'rh-media-v1';

const SHELL = [
  '/',
  '/index.html',
  '/orbit.html',
  '/cards.html',
  '/history.html',
  '/exam.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/styles.css?v=20261111b',
  '/js/main.js?v=20261111a',
  '/js/orbit.js?v=20261031c',
  '/js/cards.js?v=20261107b',
  '/js/history.js?v=20261111a',
  '/js/selection.js',
  '/js/exam.js?v=20261111d',
  '/js/ripple.js',
  '/js/monet.js',
  '/js/theme-sync.js',
  '/js/api.js',
  '/js/store.js',
  '/js/render.js',
  '/js/upload.js',
  '/js/preview.js',
  '/js/search.js',
  '/js/collect.js',
  '/js/edit.js',
  '/js/settings.js',
  '/js/theme.js',
  '/js/toast.js',
  '/js/offline.js',
  '/js/pending.js',
  '/js/vault.js',
  '/js/pixelboard.js',
  '/js/assistant.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== MEDIA_CACHE).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request, cacheName, fallback = '', timeoutMs = 0) {
  const cache = await caches.open(cacheName);
  try {
    const responsePromise = fetch(request);
    const response = timeoutMs
      ? await Promise.race([
          responsePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ])
      : await responsePromise;

    if (response && response.ok && response.status === 200 && !request.headers.has('range')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirstMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.status === 200 && !request.headers.has('range')) {
      const length = Number(response.headers.get('content-length') || 0);
      if (!length || length <= 30 * 1024 * 1024) {
        cache.put(request, response.clone()).catch(() => {});
      }
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (/\/api\/files\/[^/]+\/(raw|cover)$/.test(url.pathname)) {
      event.respondWith(networkFirstMedia(request));
    }
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/index.html', 4000));
    return;
  }

  if (/\.(?:css|js)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, '', 3000));
    return;
  }

  event.respondWith(cacheFirst(request));
});
