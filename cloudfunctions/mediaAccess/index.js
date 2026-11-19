'use strict'

// 所有媒体权限都在服务端按调用者身份校验。客户端不再直接拥有云存储读写权限。
const cloudbase = require('@cloudbase/node-sdk')
const {
  buildMediaPath,
  isSafeSegment,
  uniqueOwnedFileIDs,
} = require('./policy')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const MAX_FILES_PER_CALL = 50
const URL_TTL_SECONDS = 10 * 60

class ClientError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** openid 若已绑定网页版账号，返回对应的 customUserId；否则返回空串。 */
async function resolveBoundCustomUserId(openId) {
  try {
    const result = await db.collection('users').where({ openId }).limit(1).get()
    const doc = Array.isArray(result.data) ? result.data[0] : (result.data || null)
    return doc && doc._id ? String(doc._id) : ''
  } catch (error) {
    console.warn('mediaAccess 查询账号绑定关系失败', error)
    return ''
  }
}

/** 当前调用者身份：已绑定的小程序 openid → customUserId；网页自定义登录 → customUserId；未绑定 openid → openid。 */
async function currentUserId() {
  try {
    const info = app.auth().getUserInfo()
    if (info.isAnonymous) return ''
    if (info.customUserId) return info.customUserId
    const openId = info.openId || ''
    if (openId) {
      const bound = await resolveBoundCustomUserId(openId)
      if (bound) return bound
    }
    return info.uid || ''
  } catch {
    return ''
  }
}

function docData(result) {
  const data = result && result.data
  if (data && typeof data === 'object' && !Array.isArray(data)) return data
  if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === 'object') return data[0]
  return null
}

async function verifiedWorkspace(userId) {
  const membershipResult = await db.collection('couple_members').where({ userId }).limit(5).get()
  const memberships = Array.isArray(membershipResult.data) ? membershipResult.data : []
  const verified = new Set()

  for (const membership of memberships) {
    const coupleId = String(membership.coupleId || '')
    if (!isSafeSegment(coupleId)) continue
    const coupleResult = await db.collection('couples').doc(coupleId).get().catch(() => null)
    const couple = docData(coupleResult)
    const memberIds = couple && Array.isArray(couple.memberIds) ? couple.memberIds.map(String) : []
    if (String(membership._id) === `${coupleId}_${userId}` && memberIds.includes(userId)) verified.add(coupleId)
  }

  if (verified.size === 0) {
    throw new ClientError('NO_WORKSPACE', '你还没有加入情侣空间')
  }
  if (verified.size > 1) {
    throw new ClientError('AMBIGUOUS_WORKSPACE', '账号空间数据异常，请联系管理员处理')
  }
  return { coupleId: [...verified][0] }
}

function clientFileIDs(event) {
  try {
    return uniqueOwnedFileIDs(event.fileIDs, event.coupleId, MAX_FILES_PER_CALL)
  } catch (error) {
    throw new ClientError('INVALID_FILE_PATH', error.message || '文件路径不正确')
  }
}

async function prepareUpload(event, coupleId) {
  let cloudPath
  try {
    cloudPath = buildMediaPath(
      coupleId,
      event.memoryId,
      event.mediaId || event.photoId,
      event.extension,
    )
  } catch (error) {
    throw new ClientError('INVALID_UPLOAD_PATH', error.message || '上传路径不正确')
  }

  const result = await app.getUploadMetadata({ cloudPath, method: 'post' })
  if (result && result.code) {
    throw new Error(`CloudBase 上传凭据接口失败：${result.code}`)
  }
  const metadata = result && result.data
  if (
    !metadata
    || !metadata.url
    || !metadata.token
    || !metadata.authorization
    || !metadata.fileId
    || !metadata.cosFileId
  ) {
    throw new Error('CloudBase 没有返回完整的上传凭据')
  }

  return {
    ok: true,
    upload: {
      url: metadata.url,
      token: metadata.token,
      authorization: metadata.authorization,
      fileID: metadata.fileId,
      cosFileId: metadata.cosFileId,
      cloudPath,
      successStatus: 201,
    },
  }
}

async function getUrls(event, coupleId) {
  const fileIDs = clientFileIDs({ ...event, coupleId })
  if (fileIDs.length === 0) return { ok: true, files: [], expiresAt: Date.now() }

  const result = await app.getTempFileURL({
    fileList: fileIDs.map((fileID) => ({ fileID, maxAge: URL_TTL_SECONDS })),
  })
  if (result && result.code) {
    throw new Error(`CloudBase 临时链接接口失败：${result.code}`)
  }
  const files = Array.isArray(result.fileList) ? result.fileList : []
  if (files.length !== fileIDs.length) {
    throw new Error('CloudBase 没有返回完整的临时链接结果')
  }
  return {
    ok: true,
    files: files.map((item) => ({
      fileID: String(item.fileID || item.fileid || ''),
      url: String(item.tempFileURL || item.download_url || ''),
      code: String(item.code || ''),
      message: String(item.message || ''),
    })),
    // 客户端会在此时间前主动刷新，避免会话缓存持有过期 URL。
    expiresAt: Date.now() + URL_TTL_SECONDS * 1000,
  }
}

async function deleteFiles(event, coupleId) {
  const fileIDs = clientFileIDs({ ...event, coupleId })
  if (fileIDs.length === 0) return { ok: true, files: [] }

  const result = await app.deleteFile({ fileList: fileIDs })
  if (result && result.code) {
    throw new Error(`CloudBase 删除接口失败：${result.code}`)
  }
  const files = Array.isArray(result.fileList) ? result.fileList : []
  if (files.length !== fileIDs.length) {
    throw new Error('CloudBase 没有返回完整的删除结果')
  }
  const failed = files.filter((item) => item.code && item.code !== 'SUCCESS')
  if (failed.length > 0) {
    throw new Error(`有 ${failed.length} 个文件删除失败`)
  }
  return { ok: true, files }
}

exports.main = async (event = {}) => {
  const action = String(event.action || '')
  if (!['prepareUpload', 'getUrls', 'deleteFiles'].includes(action)) {
    return { ok: false, code: 'INVALID_ACTION', message: '不支持的媒体操作' }
  }

  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, code: 'UNAUTHENTICATED', message: '登录状态无效，请重新登录后再试' }
  }

  try {
    const { coupleId } = await verifiedWorkspace(userId)
    if (action === 'prepareUpload') return await prepareUpload(event, coupleId)
    if (action === 'getUrls') return await getUrls(event, coupleId)
    return await deleteFiles(event, coupleId)
  } catch (error) {
    const code = error instanceof ClientError ? error.code : 'MEDIA_ACCESS_FAILED'
    const message = error instanceof ClientError ? error.message : '媒体服务暂时不可用，请稍后重试'
    if (!(error instanceof ClientError)) {
      console.error(`mediaAccess ${action} failed`, error && error.message ? error.message : error)
    }
    return { ok: false, code, message }
  }
}
