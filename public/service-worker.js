/**
 * VOYO Music Service Worker
 * Handles caching and offline functionality
 * BACKGROUND PLAYBACK: Enhanced to cache audio streams
 */

const CACHE_NAME = 'voyo-v40';
const AUDIO_CACHE_NAME = 'voyo-audio-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches + signal open tabs that a new SW is ready
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const oldCaches = cacheNames.filter((name) => name !== CACHE_NAME && name !== AUDIO_CACHE_NAME);
      return Promise.all(oldCaches.map((name) => caches.delete(name))).then(() => {
        // Auto-update broadcast (ported from Tivi+): when we activate AFTER
        // replacing an old version, postMessage every open tab so they can
        // surface an "Update available" prompt. Skipped on first install
        // (no old caches to purge means there was nothing to update FROM).
        if (oldCaches.length > 0) {
          self.clients.matchAll({ type: 'window' }).then((tabs) => {
            console.log('[SW] Signaling ' + tabs.length + ' tab(s) — new build ready');
            tabs.forEach((tab) => tab.postMessage({ type: 'SW_UPDATED' }));
          });
        }
      });
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // === BACKGROUND PLAYBACK: Handle audio streaming requests ===
  // Cache CDN audio streams and Piped API streams for background playback
  const isAudioRequest =
    url.pathname.includes('/cdn/stream') ||
    url.hostname.includes('pipedapi') ||
    event.request.destination === 'audio';

  if (isAudioRequest) {
    event.respondWith(
      caches.open(AUDIO_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cached => {
          // If cached, return it
          if (cached) {
            // Audio cache hit
            return cached;
          }

          // Not cached - fetch from network
          return fetch(event.request).then(response => {
            // Only cache successful audio responses
            if (response.ok && response.status === 200) {
              // Clone before caching (response can only be read once)
              cache.put(event.request, response.clone());
              // Audio cached
            }
            return response;
          }).catch(error => {
            // Network failed - check cache one more time
            return cache.match(event.request).then(cachedFallback => {
              if (cachedFallback) {
                // Audio network failed, using cache
                return cachedFallback;
              }
              throw error;
            });
          });
        });
      })
    );
    return;
  }

  // Skip cross-origin requests (YouTube, other APIs)
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip version.json entirely — it MUST hit the network every time so the
  // update-detection poll sees fresh data. If the SW caches it, the
  // UpdateButton compares __APP_VERSION__ to a stale cached version and
  // never fires the update prompt. `return` without respondWith → default
  // browser fetch, which bypasses the SW cache layer.
  if (event.request.url.includes('/version.json')) return;

  // Skip Vite dev server resources (HMR, react-refresh, etc.)
  if (event.request.url.includes('@vite') ||
      event.request.url.includes('@react-refresh') ||
      event.request.url.includes('node_modules') ||
      event.request.url.includes('.hot-update')) {
    return;
  }

  // Navigation requests (HTML) — NETWORK FIRST (always get fresh index.html)
  // Only cache 200 OK responses. Without this guard a 500/404/503 from origin
  // becomes the permanently-cached "version" of index.html until manual cache
  // clear — silent data corruption that brick the app for the user.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then((cached) => cached || caches.match('/offline.html'));
        })
    );
    return;
  }

  // Hashed assets (JS/CSS with content hash) — CACHE FIRST (hash = immutable)
  // Non-hashed assets — NETWORK FIRST
  const isHashedAsset = event.request.url.match(/\/assets\/.*-[a-zA-Z0-9]{8,}\.(js|css)$/);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Other static assets (images, icons) — STALE WHILE REVALIDATE
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response.status === 200 && event.request.url.match(/\.(svg|png|jpg|webp|woff2?)$/)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return cached || new Response('', { status: 408, statusText: 'Offline' });
        });
      return cached || fetchPromise;
    })
  );
});

// Handle skip waiting message
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'TEST_PUSH') {
    self.registration.showNotification('VOYO Test', {
      body: 'Push notifications are working.',
      icon: '/icon-192.png',
    });
  }
});

// ============================================
// PUSH NOTIFICATIONS
// ============================================

// Push notification handler
self.addEventListener('push', (event) => {
  let data = { title: 'VOYO', body: 'New update' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data.body = event.data?.text() || 'New update';
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'VOYO', {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      tag: 'voyo-notification',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
