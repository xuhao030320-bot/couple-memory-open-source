import { Download, Expand, PlayCircle } from 'lucide-react'
import { useState } from 'react'
import type { PhotoAsset } from '../types'

interface MediaAssetViewProps {
  asset: PhotoAsset
  className?: string
  controls?: boolean
  muted?: boolean
  /** 点击打开大图预览（视频上会显示一个角落放大按钮，避免与播放控件冲突）。 */
  onClick?: () => void
}

export function MediaAssetView({
  asset,
  className = '',
  controls = true,
  muted = false,
  onClick,
}: MediaAssetViewProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const videoFailed = failedSource === asset.src

  if (asset.kind !== 'video') {
    return (
      <img
        className={`${className}${onClick ? ' is-clickable' : ''}`}
        src={asset.src}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
        style={{ objectPosition: `${asset.focusX * 100}% ${asset.focusY * 100}%` }}
        onClick={onClick}
      />
    )
  }

  if (videoFailed) {
    return (
      <div className={`video-fallback ${className}`}>
        <PlayCircle size={28} />
        <span>当前浏览器不能播放这段视频</span>
        {controls && <a href={asset.src} download={asset.name}><Download size={15} />下载原视频</a>}
      </div>
    )
  }

  return (
    <span className={`media-video-wrap ${className}`}>
      <video
        className="media-video-inner"
        src={asset.src}
        controls={controls}
        muted={muted}
        playsInline
        preload={controls ? 'metadata' : 'none'}
        aria-label={asset.alt}
        style={{ objectPosition: `${asset.focusX * 100}% ${asset.focusY * 100}%` }}
        onError={() => setFailedSource(asset.src)}
      />
      {onClick && (
        <button className="media-expand-button" type="button" aria-label="放大预览视频" onClick={onClick}><Expand size={14} /></button>
      )}
    </span>
  )
}
