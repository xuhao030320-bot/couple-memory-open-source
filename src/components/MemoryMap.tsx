import { ExternalLink, MapPin } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { amapOpenUrl, isAMapConfigured, loadAMap } from '../lib/amap'

interface MemoryMapProps {
  latitude?: number
  longitude?: number
  location?: string
  compact?: boolean
}

function validCoordinates(latitude?: number, longitude?: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Number(latitude) >= -90
    && Number(latitude) <= 90
    && Number(longitude) >= -180
    && Number(longitude) <= 180
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function MemoryMap({ latitude, longitude, location = '', compact = false }: MemoryMapProps) {
  const valid = validCoordinates(latitude, longitude)
  const [expanded, setExpanded] = useState(!compact)
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const mapId = useId()
  const lat = Number(latitude)
  const lng = Number(longitude)

  useEffect(() => {
    if (!valid || !expanded || !containerRef.current || mapRef.current) return
    let disposed = false
    loadAMap()
      .then((AMap) => {
        if (disposed || !containerRef.current) return
        const map = new AMap.Map(containerRef.current, {
          center: [lng, lat],
          zoom: 13,
          viewMode: '2D',
          // 展示用途：不随滚动缩放、不拖走，避免干扰阅读
          dragEnable: false,
          scrollWheel: false,
          doubleClickZoom: false,
          keyboardEnable: false,
        })
        map.add(new AMap.Marker({ position: [lng, lat] }))
        mapRef.current = map
      })
      .catch(() => setFailed(true))
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, lat, lng, valid])

  if (!valid) return null

  return (
    <section className={`memory-map ${compact ? 'is-compact' : ''}`}>
      <div className="memory-map-heading">
        <span><MapPin size={16} />{location || '这段回忆的位置'}</span>
        <div>
          {compact && (
            <button type="button" aria-expanded={expanded} aria-controls={mapId} onClick={() => setExpanded((current) => !current)}>
              {expanded ? '收起地图' : '查看地图'}
            </button>
          )}
          <a href={amapOpenUrl(lat, lng, location)} target="_blank" rel="noreferrer">在地图中打开 <ExternalLink size={13} /></a>
        </div>
      </div>
      {expanded && (
        <div id={mapId} className="memory-map-canvas" ref={containerRef}>
          {failed && (
            <p className="memory-map-fallback">
              地图加载失败，<a href={amapOpenUrl(lat, lng, location)} target="_blank" rel="noreferrer">点这里在外部地图中打开</a>
            </p>
          )}
        </div>
      )}
      <small>地图数据 © 高德地图{isAMapConfigured() ? '' : '（未配置 Key）'}</small>
    </section>
  )
}
