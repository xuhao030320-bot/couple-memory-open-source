import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { useEffect } from 'react'
import type { PhotoAsset } from '../types'

interface PhotoLightboxProps {
  photos: PhotoAsset[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
}

export function PhotoLightbox({ photos, index, onNavigate, onClose }: PhotoLightboxProps) {
  const photo = photos[index]

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') onNavigate((index - 1 + photos.length) % photos.length)
      else if (event.key === 'ArrowRight') onNavigate((index + 1) % photos.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [index, photos.length, onNavigate, onClose])

  if (!photo) return null

  const showPrev = photos.length > 1
  const showNext = photos.length > 1

  return (
    <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="照片预览" onClick={onClose}>
      <div className="photo-lightbox-stage" onClick={(event) => event.stopPropagation()}>
        <header className="photo-lightbox-bar">
          <span className="photo-lightbox-count">{index + 1} / {photos.length}{photo.name ? ` · ${photo.name}` : ''}</span>
          <button type="button" aria-label="关闭预览" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="photo-lightbox-body">
          {showPrev && (
            <button className="photo-lightbox-nav is-prev" type="button" aria-label="上一张" onClick={() => onNavigate((index - 1 + photos.length) % photos.length)}>
              <ChevronLeft size={28} />
            </button>
          )}
          {photo.kind === 'video' ? (
            <video className="photo-lightbox-media" src={photo.src} controls autoPlay playsInline aria-label={photo.alt} />
          ) : (
            <img className="photo-lightbox-media" src={photo.src} alt={photo.alt} />
          )}
          {showNext && (
            <button className="photo-lightbox-nav is-next" type="button" aria-label="下一张" onClick={() => onNavigate((index + 1) % photos.length)}>
              <ChevronRight size={28} />
            </button>
          )}
        </div>

        <footer className="photo-lightbox-bar">
          <span>{photo.caption || ''}</span>
          <a href={photo.src} download={photo.name} rel="noreferrer"><Download size={15} />下载原文件</a>
        </footer>
      </div>
    </div>
  )
}
