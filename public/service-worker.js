/**
 * VOYO Music Service Worker
 * Handles caching and offline functionality
 * BACKGROUND PLAYBACK: Enhanced to cache audio streams
 */

const CACHE_NAME = 'voyo-v3';
const AUDIO_CACHE_NAME = 'voyo-audio-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/icons/voyo-192.svg',
  '/icons/voyo-512.svg'
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

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
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
            console.log('[SW] Audio cache hit:', url.pathname);
            return cached;
          }

          // Not cached - fetch from network
          return fetch(event.request).then(response => {
            // Only cache successful audio responses
            if (response.ok && response.status === 200) {
              // Clone before caching (response can only be read once)
              cache.put(event.request, response.clone());
              console.log('[SW] Audio cached:', url.pathname);
            }
            return response;
          }).catch(error => {
            // Network failed - check cache one more time
            return cache.match(event.request).then(cachedFallback => {
              if (cachedFallback) {
                console.log('[SW] Audio network failed, using cache:', url.pathname);
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

  // Skip Vite dev server resources (HMR, react-refresh, etc.)
  if (event.request.url.includes('@vite') ||
      event.request.url.includes('@react-refresh') ||
      event.request.url.includes('node_modules') ||
      event.request.url.includes('.hot-update')) {
    return;
  }

  // Standard caching for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached version or fetch from network
      return cached || fetch(event.request)
        .then((response) => {
          // Cache successful responses for static assets
          if (response.status === 200 && event.request.url.match(/\.(js|css|svg|png|jpg|webp)$/)) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Network error - return cached if available, otherwise fail silently
          return cached || new Response('', { status: 408, statusText: 'Request timeout' });
        });
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
      icon: '/icons/voyo-192.svg',
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
      icon: data.icon || '/icons/voyo-192.svg',
      badge: '/icons/voyo-192.svg',
      data: { url: data.url || '/' },
      tag: 'voyo-notification',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
