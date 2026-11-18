import { ArrowRight, Camera, Expand } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import HTMLFlipBook from 'react-pageflip'
import { createHomeAlbumPages, nextHomeAlbumPage } from '../features/memories/home-album'
import { useReducedMotion } from '../lib/use-reduced-motion'
import type { PhotoAsset } from '../types'
import { MediaAssetView } from './MediaAssetView'
import { PhotoLightbox } from './PhotoLightbox'

interface HomeAlbumProps {
  photos: PhotoAsset[]
  onCompose: () => void
}

export default function HomeAlbum({ photos, onCompose }: HomeAlbumProps) {
  const [photoPool] = useState(() => createHomeAlbumPages(photos))
  const reducedMotion = useReducedMotion()
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const lightboxOpen = lightboxIndex !== null
  const bookRef = useRef<React.ComponentRef<typeof HTMLFlipBook> | null>(null)
  const currentPageRef = useRef(0)
  const bookHostRef = useRef<HTMLDivElement | null>(null)
  const zoomButtonRef = useRef<HTMLButtonElement | null>(null)
  const lightboxRef = useRef<HTMLDivElement | null>(null)
  const [bookSize, setBookSize] = useState<{ width: number; height: number } | null>(null)
  // Keep these children stable: recreating them during preview navigation reloads the flip engine.
  const pages = useMemo(() => photoPool.map((photo, index) => (
    <div key={`${photo.id}-${index}`} className="pageflip-page">
      <div className="pageflip-media-frame"><MediaAssetView asset={photo} controls={false} muted /></div>
    </div>
  )), [photoPool])
  // Keep the open-book spread on phones too; the frame grows without changing the page layout.
  const pageWidth = bookSize ? Math.max(1, Math.floor(bookSize.width / 2)) : 1

  useEffect(() => {
    const host = bookHostRef.current
    if (!host) return
    const update = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const next = { width: Math.max(2, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) }
      setBookSize((current) => current?.width === next.width && current.height === next.height ? current : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (photoPool.length <= 2) return
    const host = bookHostRef.current
    if (!host) return
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let inViewport = true
    let interacting = false
    let focused = false
    let timer: number | undefined
    const stopAutoFlip = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }
    const flipNextSpread = () => {
      if (motionPreference.matches) return
      const pageFlip = bookRef.current?.pageFlip?.()
      if (!pageFlip) return
      if (pageFlip.getState() !== 'read') return
      const nextPage = nextHomeAlbumPage(pageFlip.getCurrentPageIndex(), pageFlip.getPageCount())
      if (nextPage !== null) pageFlip.flip(nextPage)
    }
    const syncAutoFlip = () => {
      stopAutoFlip()
      if (!motionPreference.matches && !lightboxOpen && inViewport && !interacting && !focused && document.visibilityState === 'visible') {
        timer = window.setInterval(flipNextSpread, 10000)
      }
    }
    const enter = () => { interacting = true; syncAutoFlip() }
    const leave = () => { interacting = false; syncAutoFlip() }
    const focusIn = () => { focused = true; syncAutoFlip() }
    const focusOut = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && host.contains(event.relatedTarget)
      syncAutoFlip()
    }
    const observer = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting
      syncAutoFlip()
    }, { threshold: .15 })
    observer.observe(host)
    syncAutoFlip()
    motionPreference.addEventListener('change', syncAutoFlip)
    document.addEventListener('visibilitychange', syncAutoFlip)
    host.addEventListener('pointerenter', enter)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('focusin', focusIn)
    host.addEventListener('focusout', focusOut)
    return () => {
      stopAutoFlip()
      observer.disconnect()
      motionPreference.removeEventListener('change', syncAutoFlip)
      document.removeEventListener('visibilitychange', syncAutoFlip)
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('focusin', focusIn)
      host.removeEventListener('focusout', focusOut)
    }
  }, [photoPool.length, lightboxOpen])

  useEffect(() => {
    if (!lightboxOpen) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    lightboxRef.current?.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')?.focus()
    return () => {
      document.body.style.overflow = overflow
      zoomButtonRef.current?.focus({ preventScroll: true })
    }
  }, [lightboxOpen])

  function openLargePhoto() {
    const book = bookRef.current?.pageFlip?.()
    book?.getRender().finishAnimation()
    setLightboxIndex(Math.min(book?.getCurrentPageIndex() ?? currentPageRef.current, photoPool.length - 1))
  }

  function trapLightboxFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable = [...(lightboxRef.current?.querySelectorAll<HTMLElement>('button, a[href], video[controls]') ?? [])]
      .filter(element => element.tabIndex >= 0)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return (
    <div className="hero-collage home-album" role="group" aria-label="翻书相册">
      <div className="book-shell">
        <div className="pageflip-host" ref={bookHostRef}>
          {photoPool.length === 0 ? (
            <div className="hero-empty home-album-empty">
              <Camera size={28} aria-hidden="true" />
              <div><span className="eyebrow">OUR LITTLE ALBUM</span><h3>这里会装下我们的瞬间</h3><p>下一次心动，就留在这里。</p></div>
              <button className="text-link" type="button" onClick={onCompose}>留下第一张照片 <ArrowRight size={15} /></button>
            </div>
          ) : bookSize ? (
            <HTMLFlipBook
              key={`${bookSize.width}x${bookSize.height}:${reducedMotion}`}
              ref={bookRef}
              width={pageWidth}
              height={bookSize.height}
              size="stretch"
              minWidth={1}
              maxWidth={pageWidth}
              minHeight={1}
              maxHeight={bookSize.height}
              showCover={false}
              flippingTime={reducedMotion ? 1 : 1200}
              drawShadow={!reducedMotion}
              usePortrait={false}
              mobileScrollSupport
              disableFlipByClick={false}
              startZIndex={0}
              style={{}}
              startPage={Math.min(currentPageRef.current, photoPool.length - 1)}
              autoSize={false}
              maxShadowOpacity={reducedMotion ? 0 : 0.5}
              onFlip={(event) => { currentPageRef.current = Number(event.data) || 0 }}
              showPageCorners={false}
              swipeDistance={30}
              clickEventForward
              useMouseEvents
              renderOnlyPageLengthChange={false}
              className="pageflip-book"
            >
              {pages}
            </HTMLFlipBook>
          ) : <div className="pageflip-loading" aria-hidden="true" />}
        </div>
      </div>
      {photoPool.length > 0 && (
        <button ref={zoomButtonRef} className="home-album-open" type="button" aria-label="查看相册大图" onClick={openLargePhoto}>
          <Expand size={16} aria-hidden="true" /><span>查看大图</span>
        </button>
      )}
      <span className="collage-flower" aria-hidden="true">✽</span>
      {lightboxIndex !== null && createPortal(
        <div className="home-album-lightbox" ref={lightboxRef} onKeyDown={trapLightboxFocus}>
          <PhotoLightbox photos={photoPool} index={lightboxIndex} onNavigate={setLightboxIndex} onClose={() => setLightboxIndex(null)} />
        </div>, document.body,
      )}
    </div>
  )
}
