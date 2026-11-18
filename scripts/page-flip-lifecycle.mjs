import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
function replaceExactly(source, before, after, count = 1) {
  if (source.split(before).length - 1 !== count) throw new Error('Page-flip lifecycle compatibility needs review after the dependency update')
  return source.replaceAll(before, after)
}

// Upstream 2.0.7 never cancels Render.start's RAF, even in PageFlip.destroy.
// Match the installed ESM explicitly and fail closed if an update changes it.
export function patchPageFlip(source) {
  source = replaceExactly(source,
    'start(){this.update();const t=e=>{this.render(e),requestAnimationFrame(t)};requestAnimationFrame(t)}',
    'start(){this.__onlyOursRunning=!0,this.update();const t=e=>{if(!this.__onlyOursRunning)return;this.render(e);if(this.__onlyOursRunning)this.__onlyOursFrame=requestAnimationFrame(t)};this.__onlyOursFrame=requestAnimationFrame(t)}stop(){this.__onlyOursRunning=!1,cancelAnimationFrame(this.__onlyOursFrame)}')
  source = replaceExactly(source,
    'destroy(){this.ui.destroy(),this.block.remove()}',
    'destroy(){if(this.__onlyOursDisposed)return;this.__onlyOursDisposed=!0,this.render?.stop(),this.ui?.destroy(),this.block.remove()}')
  return replaceExactly(source,
    'setTimeout(()=>{this.ui.update(),this.trigger("init",this,',
    'setTimeout(()=>{if(this.__onlyOursDisposed)return;this.ui.update(),this.trigger("init",this,', 2)
}

// Upstream 2.0.3 has no unmount cleanup. Wait until the host is detached so
// React StrictMode's simulated cleanup cannot destroy a still-mounted book.
export function patchReactPageFlip(source) {
  return replaceExactly(source, '    const [pages, setPages] = useState([]);', `    const [pages, setPages] = useState([]);
    useEffect(() => {
        const host = htmlElementRef.current;
        return () => {
            const instance = pageFlip.current;
            queueMicrotask(() => {
                if (host && !host.isConnected) instance?.destroy();
            });
        };
    }, []);`)
}

/** The same guarded ESM is used in development and production; no install-time mutation. */
export function pageFlipLifecycle() {
  const engine = path.join(path.dirname(require.resolve('page-flip/package.json')), 'dist/js/page-flip.module.js')
  const reactWrapper = path.join(path.dirname(require.resolve('react-pageflip/package.json')), 'build/index.es.js')
  return {
    name: 'only-ours-page-flip-lifecycle', enforce: 'pre',
    resolveId(id) {
      if (id === 'page-flip') return engine
      if (id === 'react-pageflip') return reactWrapper
    },
    load(id) {
      if (id.replaceAll('\\', '/') === engine.replaceAll('\\', '/')) return patchPageFlip(fs.readFileSync(engine, 'utf8'))
      if (id.replaceAll('\\', '/') === reactWrapper.replaceAll('\\', '/')) return patchReactPageFlip(fs.readFileSync(reactWrapper, 'utf8'))
    },
  }
}
