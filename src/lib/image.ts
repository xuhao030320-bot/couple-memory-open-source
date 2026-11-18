import { inferMediaKind } from '../features/memories/memory'
import type { PhotoAsset } from '../types'

const MAX_EDGE = 1800
const JPEG_QUALITY = 0.84
const MAX_VIDEO_BYTES = 45 * 1024 * 1024
const SUPPORTED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
])

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mp4: 'video/mp4',
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = url
  })
}

async function compressImage(file: File) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await loadImage(objectUrl)
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张照片')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * HEIC/HEIF 浏览器内转 JPEG（heic2any 是 WASM 解码器）。
 * 动态 import：只有真的上传 HEIC 时才加载，避免拖累常规路径与 node 测试环境。
 */
async function convertHeic(file: File) {
  try {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.84 })
    const blob = Array.isArray(converted) ? converted[0] : converted
    if (!blob) throw new Error('转换结果为空')
    return blobAsDataUrl(blob)
  } catch {
    throw new Error('这张 HEIC 照片无法在浏览器中处理，请先用微信或相册转成 JPG 再上传')
  }
}

function normalizedMimeType(file: File) {
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
  const inferred = VIDEO_MIME_BY_EXTENSION[extension] || IMAGE_MIME_BY_EXTENSION[extension]
  const supplied = file.type.toLowerCase()
  if (!supplied || supplied === 'application/octet-stream') return inferred || supplied
  return supplied
}

async function imageSource(file: File) {
  if (/\.(heic|heif)$/i.test(file.name)) {
    return convertHeic(file)
  }
  if (file.type === 'image/gif') {
    return readFileAsDataUrl(file)
  }
  try {
    return await compressImage(file)
  } catch {
    return readFileAsDataUrl(file)
  }
}

export async function filesToPhotoAssets(files: File[]) {
  const selected = files.slice(0, 9)
  const results: PhotoAsset[] = []

  for (const [index, file] of selected.entries()) {
    const sourceMimeType = normalizedMimeType(file)
    const kind = inferMediaKind(sourceMimeType, file.name)
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name)

    if (kind === 'video' && !SUPPORTED_VIDEO_TYPES.has(sourceMimeType)) {
      throw new Error(`暂不支持 ${file.name} 的视频格式，请使用 MP4、MOV、M4V 或 WebM`)
    }
    if (kind === 'image' && !isImage) {
      throw new Error(`${file.name} 不是支持的照片或视频`)
    }
    if (kind === 'video' && file.size > MAX_VIDEO_BYTES) {
      throw new Error(`${file.name} 超过 45 MB，请先在相册中裁短或压缩`)
    }

    // Keep videos as their original File. A blob URL avoids the ~33% base64
    // expansion and the File itself can be stored by IndexedDB in local mode.
    const src = kind === 'video' ? URL.createObjectURL(file) : await imageSource(file)
    const mimeType = src.startsWith('data:image/jpeg') ? 'image/jpeg' : sourceMimeType
    results.push({
      id: crypto.randomUUID(),
      src,
      name: file.name,
      alt: `${kind === 'video' ? '上传的视频' : '上传的照片'} ${index + 1}`,
      caption: '',
      order: index,
      role: index === 0 ? 'cover' : 'supporting',
      focusX: 0.5,
      focusY: 0.5,
      kind,
      mimeType,
      blob: kind === 'video' ? file : undefined,
    })
  }

  return results
}
