import AMapLoader from '@amap/amap-jsapi-loader'

const AMAP_KEY = import.meta.env.VITE_AMAP_KEY?.trim() || ''
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim() || ''

export function isAMapConfigured() {
  return Boolean(AMAP_KEY && AMAP_SECURITY_CODE)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let amapPromise: Promise<any> | null = null

/**
 * 懒加载高德 JS API 2.0（全局单例）。
 * 安全密钥必须在加载脚本前挂到 window._AMapSecurityConfig。
 */
export function loadAMap(): Promise<any> {
  if (!amapPromise) {
    if (AMAP_KEY) {
      ;(window as unknown as { _AMapSecurityConfig?: unknown })._AMapSecurityConfig = {
        securityJsCode: AMAP_SECURITY_CODE,
      }
    }
    amapPromise = AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      plugins: ['AMap.Geocoder', 'AMap.PlaceSearch'],
    }).catch((error) => {
      amapPromise = null
      throw error
    })
  }
  return amapPromise
}

/** 坐标 → 中文地名（高德逆地理编码；失败返回空串，绝不抛出）。 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const AMap = await loadAMap()
    const geocoder = new AMap.Geocoder({})
    const address = await new Promise<string>((resolve) => {
      geocoder.getAddress(
        [longitude, latitude],
        (_status: string, result: { regeocode?: { formattedAddress?: string } }) => {
          resolve(String(result?.regeocode?.formattedAddress || ''))
        },
      )
    })
    return address.slice(0, 40)
  } catch {
    return ''
  }
}

/** 高德网页/App 打开位置链接（手机上有高德会直接唤起）。 */
export function amapOpenUrl(latitude: number, longitude: number, name: string) {
  return `https://uri.amap.com/marker?position=${longitude.toFixed(6)},${latitude.toFixed(6)}&name=${encodeURIComponent(name || '回忆位置')}`
}
