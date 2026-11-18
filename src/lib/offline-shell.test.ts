import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function worker(network: (url: string) => Promise<Response>) {
  const origin = 'https://only.test'
  const normalize = (input: string | { url: string }) => new URL(typeof input === 'string' ? input : input.url, origin).href
  const stores = new Map<string, Map<string, Response>>()
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const skipWaiting = vi.fn()
  const fetchMock = vi.fn((input: string | { url: string }) => network(normalize(input)))
  const source = fs.readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')
    .replace(/^const APP_SHELL = .+$/m, 'const APP_SHELL = ["/", "/assets/app.js", "/assets/app.css"]')
  vm.runInNewContext(source, {
    URL, Response, Promise, fetch: fetchMock,
    self: { location: { origin }, skipWaiting, clients: { claim: vi.fn() }, addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => listeners.set(name, callback) },
    caches: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const store = stores.get(name)!
        return {
          put: async (key: string | { url: string }, response: Response) => { store.set(normalize(key), response.clone()) },
          match: async (key: string | { url: string }) => store.get(normalize(key))?.clone(),
        }
      },
      keys: async () => [...stores.keys()], delete: async (key: string) => stores.delete(key),
    },
  })
  return {
    stores, skipWaiting, fetchMock,
    install: async () => {
      let pending: Promise<unknown> | undefined
      listeners.get('install')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise } })
      await pending
    },
    request: async (path: string, mode = 'cors') => {
      let pending: Promise<Response> | undefined
      const background: Promise<unknown>[] = []
      listeners.get('fetch')!({
        request: { url: normalize(path), method: 'GET', mode },
        respondWith: (promise: Promise<Response>) => { pending = promise },
        waitUntil: (promise: Promise<unknown>) => background.push(promise),
      })
      const response = await pending!
      await Promise.all(background)
      return response
    },
  }
}

function asset(url: string) {
  const extension = new URL(url).pathname.split('.').pop()
  return new Response(extension === 'js' ? 'window.offlineReady=true' : extension === 'css' ? 'body{}' : '<html>offline shell</html>', {
    headers: { 'Content-Type': extension === 'js' ? 'text/javascript' : extension === 'css' ? 'text/css' : 'text/html' },
  })
}

describe('first-install offline shell', () => {
  it('starts offline immediately after installation, with JS and CSS already cached', async () => {
    let online = true
    const runtime = worker(async (url) => { if (!online) throw new Error('offline'); return asset(url) })
    await runtime.install()
    expect(runtime.skipWaiting).toHaveBeenCalledOnce()
    online = false
    expect(await (await runtime.request('/', 'navigate')).text()).toContain('offline shell')
    expect(await (await runtime.request('/assets/app.js')).text()).toBe('window.offlineReady=true')
    expect(await (await runtime.request('/assets/app.css')).text()).toBe('body{}')
  })
  it('returns a resource error, never HTML, for a missing script while offline', async () => {
    let online = true
    const runtime = worker(async (url) => { if (!online) throw new Error('offline'); return asset(url) })
    await runtime.install()
    online = false
    const response = await runtime.request('/assets/unavailable.js')
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).not.toContain('<html>')
  })
  it('refuses installation when the server sends a login page instead of JavaScript', async () => {
    const runtime = worker(async () => new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(runtime.install()).rejects.toThrow('incomplete')
    expect(runtime.skipWaiting).not.toHaveBeenCalled()
  })
  it('does not retain an unsuccessful response as a valid offline resource', async () => {
    let failing = false
    const runtime = worker(async (url) => failing ? new Response('temporary', { status: 503 }) : asset(url))
    await runtime.install()
    failing = true
    expect((await runtime.request('/assets/new.js')).status).toBe(503)
    failing = false
    expect(await (await runtime.request('/assets/new.js')).text()).toBe('window.offlineReady=true')
  })
})
