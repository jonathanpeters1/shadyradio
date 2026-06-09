const CACHE = 'shadyradio-v4'
const PRECACHE = ['/', '/sf-logo.jpeg', '/woofer.png', '/dsp/engine.js', '/dsp/engine.wasm']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for assets
  const url = new URL(e.request.url)
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) return
  // Bypass cache for Vite dev server paths – always fetch fresh
  if (url.pathname.startsWith('/@vite/') || url.pathname.startsWith('/@react-refresh') ||
      url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/.vite/')) {
    return
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  )
})
