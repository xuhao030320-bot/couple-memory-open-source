import { Crosshair, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadAMap } from '../lib/amap'

interface MapPickerModalProps {
  /** 已有坐标时作为地图初始中心；没有则显示中国全境。 */
  initial?: { latitude: number; longitude: number }
  onConfirm: (latitude: number, longitude: number) => void
  onClose: () => void
}

interface Suggestion {
  name: string
  address: string
  latitude: number
  longitude: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function MapPickerModal({ initial, onConfirm, onClose }: MapPickerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const placeSearchRef = useRef<any>(null)
  const searchTimerRef = useRef(0)
  const [position, setPosition] = useState<[number, number] | null>(
    initial && Number.isFinite(initial.latitude) && Number.isFinite(initial.longitude)
      ? [initial.latitude, initial.longitude]
      : null,
  )
  const [keyword, setKeyword] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searchedName, setSearchedName] = useState('')
  const [locateError, setLocateError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return
    let disposed = false
    loadAMap()
      .then((AMap) => {
        if (disposed) return
        const map = new AMap.Map(container, {
          // 高德坐标顺序是 [经度, 纬度]
          center: position ? [position[1], position[0]] : [105, 35],
          zoom: position ? 15 : 4,
          viewMode: '2D',
        })
        map.on('click', (event: any) => {
          setPosition([event.lnglat.getLat(), event.lnglat.getLng()])
          setSearchedName('')
        })
        mapRef.current = map
        placeSearchRef.current = new AMap.PlaceSearch({})
        // 弹窗动画/布局稳定后校准一次画布尺寸，避免打开即空白
        window.setTimeout(() => {
          try {
            if (mapRef.current) mapRef.current.resize()
          } catch {
            // ignore
          }
        }, 300)
      })
      .catch(() => setLoadError('地图加载失败，请检查网络后重试'))
    return () => {
      disposed = true
      try {
        if (mapRef.current) {
          mapRef.current.destroy()
          mapRef.current = null
          markerRef.current = null
        }
      } catch {
        mapRef.current = null
        markerRef.current = null
      }
    }
    // 地图只初始化一次；position 的同步走下面的 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 搜索建议：输入防抖 300ms 后调用高德 PlaceSearch（数据高德出、DOM React 管）
  useEffect(() => {
    window.clearTimeout(searchTimerRef.current)
    const value = keyword.trim()
    if (!value) {
      setSuggestions([])
      return
    }
    searchTimerRef.current = window.setTimeout(() => {
      if (!placeSearchRef.current) return
      placeSearchRef.current.search(value, (status: string, result: any) => {
        if (status !== 'complete' || !result?.poiList?.pois) {
          setSuggestions([])
          return
        }
        const pois: Suggestion[] = (result.poiList.pois as any[])
          .filter((poi) => poi?.location)
          .slice(0, 8)
          .map((poi) => ({
            name: String(poi.name || ''),
            address: String(poi.address || ''),
            latitude: Number(poi.location.lat),
            longitude: Number(poi.location.lng),
          }))
        setSuggestions(pois)
      })
    }, 300)
    return () => window.clearTimeout(searchTimerRef.current)
  }, [keyword])

  function pickSuggestion(item: Suggestion) {
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return
    setPosition([item.latitude, item.longitude])
    setSearchedName(item.name)
    setKeyword(item.name)
    setSuggestions([])
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    const lnglat = [position[1], position[0]]
    if (markerRef.current) {
      try {
        markerRef.current.setPosition(lnglat)
      } catch {
        markerRef.current = null
      }
      return
    }
    loadAMap()
      .then((AMap) => {
        if (!mapRef.current) return // 组件已卸载
        try {
          const marker = new AMap.Marker({ position: lnglat, draggable: true })
          marker.on('dragend', () => {
            const pos = marker.getPosition()
            if (pos) setPosition([pos.getLat(), pos.getLng()])
          })
          map.add(marker)
          markerRef.current = marker
          map.setZoomAndCenter(15, lnglat)
          // 跳转动画结束后强制刷新画布，兜底瓦片中断导致的空白
          window.setTimeout(() => {
            try {
              if (mapRef.current) mapRef.current.resize()
            } catch {
              // ignore
            }
          }, 350)
        } catch {
          // 地图已销毁等极端情况，忽略
        }
      })
      .catch(() => setLoadError('地图加载失败，请检查网络后重试'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  function locateMe() {
    setLocateError('')
    if (!navigator.geolocation) {
      setLocateError('当前浏览器不支持定位，可以点击地图直接选点')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition([result.coords.latitude, result.coords.longitude])
        mapRef.current?.setZoomAndCenter(15, [result.coords.longitude, result.coords.latitude])
      },
      () => setLocateError('定位失败，可以点击地图直接选点'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  return (
    <div
      className="modal-backdrop map-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // 只允许点背景本身关闭：建议列表等浮层元素不会误触发关闭
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="map-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="在地图上选择位置"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div><span className="eyebrow">PICK A PLACE</span><h2>在地图上选一个位置</h2></div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="map-picker-search">
          <Search size={15} />
          <input
            aria-label="搜索地点"
            placeholder="搜索地点，如「西湖」「海底捞」"
            maxLength={40}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (suggestions.length) pickSuggestion(suggestions[0])
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="map-picker-suggestions" role="listbox" aria-label="搜索结果">
            {suggestions.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <button type="button" role="option" onClick={() => pickSuggestion(item)}>
                  <strong>{item.name}</strong>
                  <small>{item.address}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="map-picker-canvas" ref={containerRef} />
        <p className="map-picker-hint">
          {searchedName ? `已选中「${searchedName}」` : '搜索地点、点击地图放置标记，也可以拖动标记微调。'}
        </p>
        {loadError && <p className="form-error" role="alert">{loadError}</p>}
        {locateError && <p className="form-error" role="alert">{locateError}</p>}
        <div className="modal-actions map-picker-actions">
          <button className="button ghost" type="button" onClick={locateMe}><Crosshair size={15} />定位到我</button>
          <span className="map-picker-spacer" />
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="button" disabled={!position} onClick={() => position && onConfirm(position[0], position[1])}>确定这里</button>
        </div>
      </section>
    </div>
  )
}
