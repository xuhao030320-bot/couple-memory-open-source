import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { patchPageFlip, patchReactPageFlip } from '../../scripts/page-flip-lifecycle.mjs'

const require = createRequire(import.meta.url)
const engineSource = readFileSync(path.join(path.dirname(require.resolve('page-flip/package.json')), 'dist/js/page-flip.module.js'), 'utf8')
const wrapperSource = readFileSync(path.join(path.dirname(require.resolve('react-pageflip/package.json')), 'build/index.es.js'), 'utf8')

describe('installed flipbook lifecycle compatibility', () => {
  it('cancels the render loop and makes an already queued frame harmless after destruction', () => {
    const patched = patchPageFlip(engineSource)
    const methods = patched.match(/start\(\)\{this\.__onlyOursRunning[\s\S]*?(?=startAnimation\()/)?.[0]
    expect(methods).toBeTruthy()
    let sequence = 0
    const frames = new Map<number, FrameRequestCallback>()
    const raf = (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence }
    const cancel = (id: number) => frames.delete(id)
    const Renderer = new Function('requestAnimationFrame', 'cancelAnimationFrame', `return class { update() {} render() {} ${methods} }`)(raf, cancel)
    const renderer = new Renderer()
    renderer.render = vi.fn()
    renderer.start()
    expect(frames.size).toBe(1)
    const first = [...frames.values()][0]
    frames.clear()
    first(10)
    expect(renderer.render).toHaveBeenCalledOnce()
    expect(frames.size).toBe(1)
    const stale = [...frames.values()][0]
    renderer.stop()
    expect(frames.size).toBe(0)
    stale(20)
    expect(renderer.render).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('keeps StrictMode mounts alive and destroys only the detached old engine', () => {
    const patched = patchReactPageFlip(wrapperSource)
    const effect = patched.match(/useEffect\(\(\) => \{\s*const host = htmlElementRef\.current;[\s\S]*?\}, \[\]\);/)?.[0]
    expect(effect).toBeTruthy()
    const host = { isConnected: true }
    const oldEngine = { destroy: vi.fn() }
    const newEngine = { destroy: vi.fn() }
    const ref = { current: oldEngine }
    const queued: Array<() => void> = []
    let cleanup = () => {}
    new Function('useEffect', 'htmlElementRef', 'pageFlip', 'queueMicrotask', effect!)(
      (setup: () => () => void) => { cleanup = setup() }, { current: host }, ref, (callback: () => void) => queued.push(callback),
    )
    cleanup()
    queued.shift()!()
    expect(oldEngine.destroy).not.toHaveBeenCalled()
    host.isConnected = false
    cleanup()
    ref.current = newEngine
    queued.shift()!()
    expect(oldEngine.destroy).toHaveBeenCalledOnce()
    expect(newEngine.destroy).not.toHaveBeenCalled()
  })

  it('fails visibly instead of silently losing cleanup when an upstream layout changes', () => {
    expect(() => patchPageFlip(engineSource.replace('start(){this.update();', 'start(){this.changed();'))).toThrow('needs review')
    expect(() => patchReactPageFlip(wrapperSource.replace('const [pages, setPages] = useState([]);', 'const changed = [];'))).toThrow('needs review')
  })
})
