// The build replaces these constants with this release's exact hashed assets.
const CACHE_NAME = 'only-us-shell-development'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg']

function cacheable(response, url) {
  if (!response.ok) return false
  const type = response.headers.get('content-type') || ''
  if (/\.m?js$/.test(url.pathname)) return /javascript/.test(type)
  if (/\.css$/.test(url.pathname)) return /text\/css/.test(type)
  return true
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      await Promise.all(APP_SHELL.map(async (path) => {
        const response = await fetch(path, { cache: 'reload' })
        if (!cacheable(response, new URL(path, self.location.origin))) throw new Error('Offline shell is incomplete')
        await cache.put(path, response)
      }))
      await self.skipWaiting()
    } catch (error) {
      await caches.delete(CACHE_NAME)
      throw error
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('only-us-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const navigation = event.request.mode === 'navigate'
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(event.request)
    if (!navigation && url.pathname.startsWith('/assets/') && cached) return cached
    try {
      const response = await fetch(event.request)
      if (cacheable(response, url)) {
        const copy = response.clone()
        event.waitUntil(cache.put(navigation ? '/' : event.request, copy).catch(() => undefined))
        return response
      }
      if (navigation) return cached || await cache.match('/') || response
      return response
    } catch {
      if (cached) return cached
      if (navigation) {
        const shell = await cache.match('/')
        if (shell) return shell
      }
      return new Response('Offline resource unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})
