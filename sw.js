// ═══════════════════════════════════════════════════════════
//  RatMusic PWA — Service Worker
//  🐀 Cache-first para assets, network-first para nada más
// ═══════════════════════════════════════════════════════════
'use strict';

const CACHE_NAME    = 'ratmusic-v1.0.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './rat-icon.svg',
  'https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap',
];

// ── Install: pre-cache todos los assets estáticos ─────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[RatSW] Pre-cacheando assets...');
      // Cachear con fallback individual para no fallar todo si un asset falla
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[RatSW] No se pudo cachear:', url, e))
        )
      );
    }).then(() => {
      console.log('[RatSW] Instalación completa 🐀');
      return self.skipWaiting(); // Activar inmediatamente
    })
  );
});

// ── Activate: limpiar caches viejos ──────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[RatSW] Eliminando cache viejo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[RatSW] Activado, controlando clientes 🧀');
      return self.clients.claim();
    })
  );
});

// ── Fetch: estrategia según tipo de request ───────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1) Llamadas al servidor Termux local → siempre network, nunca cachear
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return; // dejar pasar normalmente
  }

  // 2) Google Fonts → cache-first con fallback
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 3) Assets propios (html, css, js, svg, manifest) → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 4) Cualquier otra cosa → network con fallback a cache
  event.respondWith(networkFirst(event.request));
});

// ── Estrategias de caché ──────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    // Offline y no en cache
    return offlineFallback(request);
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch(e) {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

function offlineFallback(request) {
  // Si piden HTML, devolver index como fallback
  if (request.destination === 'document') {
    return caches.match('./index.html');
  }
  // Para otros recursos, respuesta vacía
  return new Response('', {
    status: 503,
    statusText: 'Offline — RatMusic sin conexión',
  });
}

// ── Background Sync (para cuando vuelva la conexión) ─────
self.addEventListener('sync', event => {
  if (event.tag === 'rat-sync') {
    console.log('[RatSW] Background sync activado 🐀');
  }
});

// ── Push Notifications (futuro) ───────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() ?? { title: 'RatMusic', body: '🐀 Notificación rata' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './rat-icon.svg',
      badge: './rat-icon.svg',
    })
  );
});

console.log('[RatSW] Service Worker cargado 🐀🧀');
