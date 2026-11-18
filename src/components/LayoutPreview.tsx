import { Image as ImageIcon, MapPin } from 'lucide-react'
import type { CSSProperties } from 'react'
import { daysSince, formatMemoryDate } from '../lib/date'
import type { LayoutStyle, LayoutTemplate, PhotoAsset } from '../types'
import { MediaAssetView } from './MediaAssetView'

interface LayoutPreviewProps {
  title: string
  text: string
  date: string
  location: string
  style: LayoutStyle
  template: LayoutTemplate
  photos: PhotoAsset[]
  tags?: string[]
  moodEmoji?: string
  moodText?: string
  compact?: boolean
  /** 自定义氛围色（hex），覆盖排版的 --layout-accent。 */
  themeColor?: string
  /** 点击某张照片时回调（索引基于 photos 按 order 排序后的顺序）。 */
  onPhotoClick?: (index: number) => void
}

function Media({ photo, className = '', onClick }: { photo?: PhotoAsset; className?: string; onClick?: () => void }) {
  if (!photo) {
    return (
      <div className={`preview-photo preview-placeholder ${className}`}>
        <ImageIcon size={28} strokeWidth={1.5} />
        <span>把这一刻放在这里</span>
      </div>
    )
  }

  return (
    <figure className={`preview-photo ${photo.kind === 'video' ? 'is-video' : ''} ${className}`}>
      <MediaAssetView asset={photo} onClick={onClick} />
      {photo.caption && <figcaption>{photo.caption}</figcaption>}
    </figure>
  )
}

export function LayoutPreview({
  title,
  text,
  date,
  location,
  style,
  template,
  photos,
  tags = [],
  moodEmoji = '',
  moodText = '',
  compact = false,
  onPhotoClick,
  themeColor,
}: LayoutPreviewProps) {
  const ordered = [...photos].sort((a, b) => a.order - b.order)
  const safeTitle = title || '今天，也值得被记住'
  const safeText = text || '写下一点当时的心情，未来再回来看看。'
  // 氛围色 = 整卡的底色，而不只是点缀：主色 + 纸面淡染 + 文字色调一并覆盖。
  const accentStyle = themeColor
    ? {
        '--layout-accent': themeColor,
        '--layout-paper': `color-mix(in srgb, ${themeColor} 14%, #fffaf0)`,
        '--layout-ink': `color-mix(in srgb, ${themeColor} 42%, #39332e)`,
      } as CSSProperties
    : undefined

  if (template === 'film-strip') {
    return (
      <article className={`memory-layout film-layout style-${style} ${compact ? 'is-compact' : ''}`} style={accentStyle}>
        <header className="film-heading">
          <div><span className="eyebrow">OUR FILM · {date.slice(0, 4)}</span><h3>{safeTitle}</h3></div>
          <span className="film-count">{String(ordered.length || 1).padStart(2, '0')}</span>
        </header>
        <div className="film-rail" role="region" tabIndex={0} aria-label="媒体横向列表">
          {(ordered.length ? ordered : [undefined, undefined]).slice(0, compact ? 3 : 6).map((photo, index) => (
            <div className="film-frame" key={photo?.id || `placeholder-${index}`}>
              <Media photo={photo} onClick={photo && onPhotoClick ? () => onPhotoClick(index) : undefined} />
              <small>{String(index + 1).padStart(2, '0')}</small>
            </div>
          ))}
        </div>
        <div className="film-copy">
          <div className="film-copy-text"><p>{safeText}</p><MemoryMood emoji={moodEmoji} text={moodText} /></div>
          <MemoryMeta date={date} location={location} tags={tags} />
        </div>
      </article>
    )
  }

  if (template === 'quiet-column') {
    return (
      <article className={`memory-layout quiet-layout style-${style} ${compact ? 'is-compact' : ''}`} style={accentStyle}>
        <div className="quiet-number">{new Date(`${date}T00:00:00`).getDate().toString().padStart(2, '0')}</div>
        <header><span className="eyebrow">A QUIET MOMENT</span><h3>{safeTitle}</h3></header>
        <Media photo={ordered[0]} className="quiet-photo" onClick={ordered[0] && onPhotoClick ? () => onPhotoClick(0) : undefined} />
        <div className="quiet-copy">
          <p>{safeText}</p>
          <MemoryMood emoji={moodEmoji} text={moodText} />
          <MemoryMeta date={date} location={location} tags={tags} />
        </div>
      </article>
    )
  }

  if (template === 'hero-grid') {
    return (
      <article className={`memory-layout grid-layout style-${style} ${compact ? 'is-compact' : ''}`} style={accentStyle}>
        <div className="grid-photos">
          <Media photo={ordered[0]} className="grid-cover" onClick={ordered[0] && onPhotoClick ? () => onPhotoClick(0) : undefined} />
          <Media photo={ordered[1]} onClick={ordered[1] && onPhotoClick ? () => onPhotoClick(1) : undefined} />
          <Media photo={ordered[2]} onClick={ordered[2] && onPhotoClick ? () => onPhotoClick(2) : undefined} />
        </div>
        <div className="grid-copy">
          <span className="eyebrow">STORY OF THE DAY</span>
          <h3>{safeTitle}</h3>
          <p>{safeText}</p>
          <MemoryMood emoji={moodEmoji} text={moodText} />
          <MemoryMeta date={date} location={location} tags={tags} />
        </div>
      </article>
    )
  }

  const gridCount = template === 'grid-4' ? 4 : template === 'grid-6' ? 6 : template === 'grid-9' ? 9 : 0
  if (gridCount > 0) {
    return (
      <article className={`memory-layout grid-n-layout grid-${gridCount}-layout style-${style} ${compact ? 'is-compact' : ''}`} style={accentStyle}>
        <div className={`grid-n-photos grid-n-${gridCount}`}>
          {Array.from({ length: gridCount }, (_, index) => (
            <Media key={ordered[index]?.id || `cell-${index}`} photo={ordered[index]} className="grid-n-cell" onClick={ordered[index] && onPhotoClick ? () => onPhotoClick(index) : undefined} />
          ))}
        </div>
        <div className="grid-n-copy">
          <span className="eyebrow">OUR MOMENTS</span>
          <h3>{safeTitle}</h3>
          <p>{safeText}</p>
          <MemoryMood emoji={moodEmoji} text={moodText} />
          <MemoryMeta date={date} location={location} tags={tags} />
        </div>
      </article>
    )
  }

  return (
    <article className={`memory-layout hero-note-layout style-${style} ${compact ? 'is-compact' : ''}`} style={accentStyle}>
      <Media photo={ordered[0]} className="hero-note-photo" onClick={ordered[0] && onPhotoClick ? () => onPhotoClick(0) : undefined} />
      <div className="hero-note-paper">
        <span className="paper-tape" aria-hidden="true" />
        <span className="eyebrow">{formatMemoryDate(date)}</span>
        <h3>{safeTitle}</h3>
        <p>{safeText}</p>
        <MemoryMood emoji={moodEmoji} text={moodText} />
        <MemoryMeta date={date} location={location} tags={tags} />
      </div>
    </article>
  )
}

function MemoryMood({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className={`memory-mood ${!emoji && !text ? 'is-empty' : ''}`}>
      <span aria-hidden="true">{emoji || '💭'}</span>
      <small>{text || '这天还没有记录心情'}</small>
    </div>
  )
}

function MemoryMeta({ date, location, tags }: { date: string; location: string; tags: string[] }) {
  const elapsed = daysSince(date)
  return (
    <footer className="memory-meta">
      <span>{formatMemoryDate(date)}</span>
      {elapsed !== null && <span className="elapsed-badge">{elapsed === 0 ? '就是今天' : `已发生 ${elapsed} 天`}</span>}
      {location && <span><MapPin size={12} />{location}</span>}
      {tags.slice(0, 2).map((tag) => <span className="meta-tag" key={tag}>#{tag}</span>)}
    </footer>
  )
}
