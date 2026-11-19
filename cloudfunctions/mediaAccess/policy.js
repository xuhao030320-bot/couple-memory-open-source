'use strict'

const MEDIA_ROOT = 'couple-photos'
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'heic',
  'heif',
  'mov',
  'webm',
  'm4v',
  'mp4',
])

function isSafeSegment(value) {
  return SAFE_SEGMENT.test(String(value || ''))
}

function normalizeExtension(value) {
  const extension = String(value || '').trim().toLowerCase().replace(/^\./, '')
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('不支持这种照片或视频格式')
  }
  return extension === 'jpeg' ? 'jpg' : extension
}

function requireSafeSegment(value, label) {
  const segment = String(value || '').trim()
  if (!isSafeSegment(segment)) {
    throw new Error(`${label}格式不正确`)
  }
  return segment
}

function buildMediaPath(coupleId, memoryId, mediaId, extension) {
  const safeCoupleId = requireSafeSegment(coupleId, '情侣空间')
  const safeMemoryId = requireSafeSegment(memoryId, '回忆编号')
  const safeMediaId = requireSafeSegment(mediaId, '媒体编号')
  const safeExtension = normalizeExtension(extension)
  return `${MEDIA_ROOT}/${safeCoupleId}/${safeMemoryId}/${safeMediaId}.${safeExtension}`
}

/**
 * CloudBase fileID 形如 cloud://env.bucket/couple-photos/...；迁移数据中也可能只保存路径。
 * 这里只接受这两种形式，拒绝 https URL、编码斜杠和额外目录层级。
 */
function pathFromFileID(fileID) {
  const value = String(fileID || '').trim()
  if (!value || value.length > 2048) return ''
  if (value.startsWith(`${MEDIA_ROOT}/`)) return value
  if (!value.startsWith('cloud://')) return ''
  const withoutScheme = value.slice('cloud://'.length)
  const firstSlash = withoutScheme.indexOf('/')
  if (firstSlash <= 0 || !/^[A-Za-z0-9.-]+$/.test(withoutScheme.slice(0, firstSlash))) return ''
  return withoutScheme.slice(firstSlash + 1)
}

function parseMediaFile(fileID) {
  const path = pathFromFileID(fileID)
  const match = /^couple-photos\/([^/]+)\/([^/]+)\/([^/.]+)\.([A-Za-z0-9]+)$/.exec(path)
  if (!match) return null
  const [, coupleId, memoryId, mediaId, rawExtension] = match
  if (![coupleId, memoryId, mediaId].every(isSafeSegment)) return null
  let extension
  try {
    extension = normalizeExtension(rawExtension)
  } catch {
    return null
  }
  return { path, coupleId, memoryId, mediaId, extension }
}

function isOwnedMediaFile(fileID, coupleId) {
  const parsed = parseMediaFile(fileID)
  return Boolean(parsed && parsed.coupleId === coupleId)
}

function uniqueOwnedFileIDs(fileIDs, coupleId, maxFiles = 50) {
  if (!Array.isArray(fileIDs)) throw new Error('文件列表格式不正确')
  const unique = [...new Set(fileIDs.map((item) => String(item || '').trim()).filter(Boolean))]
  if (unique.length > maxFiles) throw new Error(`一次最多处理 ${maxFiles} 个文件`)
  if (unique.some((fileID) => !isOwnedMediaFile(fileID, coupleId))) {
    throw new Error('文件不属于当前情侣空间')
  }
  return unique
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MEDIA_ROOT,
  buildMediaPath,
  isOwnedMediaFile,
  isSafeSegment,
  normalizeExtension,
  parseMediaFile,
  pathFromFileID,
  uniqueOwnedFileIDs,
}
