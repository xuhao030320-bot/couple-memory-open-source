// 回收站安全网关：删除的回忆/心愿/纪念日/留言先移入 trash 集合（保留 30 天），
// 期间可恢复；过期后懒清理（连同回忆的照片文件一起彻底删除）。
// 客户端对 trash 集合读/写均被安全规则拒绝，只能通过本函数访问。
const cloudbase = require('@cloudbase/node-sdk')
const { createHash } = require('node:crypto')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const TRASH_DAYS = 30
const TRASH_DAYS_MS = TRASH_DAYS * 24 * 60 * 60 * 1000
const MAX_TRASH = 200
const KIND_COLLECTION = {
  memory: 'memories',
  wish: 'wishes',
  anniversary: 'anniversaries',
  message: 'messages',
  partner_note: 'partner_notes',
}

class AccessError extends Error {
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
    console.warn('trashAccess 查询账号绑定关系失败', error)
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
  } catch (error) {
    console.warn('trashAccess getUserInfo 失败', error)
    return ''
  }
}

function docData(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' && Object.keys(data).length ? data : null
}

function requiredId(value, fieldName) {
  const id = typeof value === 'string' ? value : ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new AccessError('INVALID_INPUT', `${fieldName}格式不正确`)
  }
  return id
}

async function requireMember(userId, coupleId) {
  const result = await db.collection('couples').doc(coupleId).get().catch(() => null)
  const couple = docData(result)
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)) {
    throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
  }
  const membership = await db.collection('couple_members')
    .where({ coupleId, userId })
    .limit(1)
    .get()
  if (!membership.data || membership.data.length === 0) {
    throw new AccessError('FORBIDDEN', '情侣空间成员信息不完整')
  }
  return couple
}

/** 回忆文档里的照片文件 ID（彻底删除时用）。 */
function fileIDsOf(doc) {
  const photos = Array.isArray(doc && doc.photos) ? doc.photos : []
  return photos
    .map((photo) => photo && (photo.fileID || photo.src || photo.storagePath))
    .filter((value) => typeof value === 'string' && value.startsWith('cloud://'))
}

async function deleteFiles(fileIDs) {
  const unique = [...new Set(fileIDs.filter(Boolean))]
  if (unique.length === 0) return
  const result = await app.deleteFile({ fileList: unique })
  if (Array.isArray(result?.fileList) && result.fileList.some((item) =>
    (item.code !== undefined && item.code !== 0 && item.code !== 'SUCCESS')
    || (item.status !== undefined && item.status !== 0))) throw new Error('文件删除未完成，请重试')
}

function publicItem(entry) {
  const doc = entry.doc || {}
  const title = String(
    doc.title
    || doc.text
    || (entry.kind === 'anniversary' ? '纪念日' : entry.kind === 'message' ? '留言' : '内容')
  ).slice(0, 60)
  return {
    id: String(entry._id || ''),
    kind: entry.kind,
    originalId: String(entry.originalId || ''),
    title,
    deletedAt: String(entry.deletedAt || ''),
    expiresAt: new Date(expiry(entry)).toISOString(),
  }
}

function expiry(entry) {
  return Date.parse(entry.expiresAt || '') || (Date.parse(entry.deletedAt || '') + TRASH_DAYS_MS) || 0
}
function visibleEntry(entry, userId) {
  if (entry.kind !== 'message') return true
  const message = entry.doc || {}
  return message.createdBy === userId || !message.revealAt || Date.parse(message.revealAt) <= Date.now()
}
async function transactionMember(transaction, coupleId, userId) {
  const couple = docData(await transaction.collection('couples').doc(coupleId).get())
  const member = docData(await transaction.collection('couple_members').doc(`${coupleId}_${userId}`).get())
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)
    || !member || member.coupleId !== coupleId || member.userId !== userId) throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
}
async function transactionEntry(transaction, coupleId, userId, id) {
  await transactionMember(transaction, coupleId, userId)
  const entry = docData(await transaction.collection('trash').doc(id).get())
  if (!entry) return null
  if (entry.coupleId !== coupleId || !visibleEntry(entry, userId)) throw new AccessError('FORBIDDEN', '无法访问这条回收站记录')
  return entry
}

/** 把回收站条目恢复回原集合。 */
async function restoreEntry(id, coupleId, userId) {
  await db.runTransaction(async (transaction) => {
    const entry = await transactionEntry(transaction, coupleId, userId, id)
    if (!entry) return
    const collection = Object.hasOwn(KIND_COLLECTION, entry.kind) && KIND_COLLECTION[entry.kind]
    if (!collection) throw new AccessError('INVALID_INPUT', '回收站条目类型无法识别')
    if (entry.purging) throw new AccessError('TRASH_PURGING', '这条记录正在彻底删除，无法恢复；可以重试彻底删除')
    if (expiry(entry) <= Date.now()) throw new AccessError('TRASH_EXPIRED', '这条记录已超过 30 天，无法恢复')
    const ref = transaction.collection(collection).doc(entry.originalId)
    if (docData(await ref.get())) throw new AccessError('RESTORE_CONFLICT', '同编号的内容已经存在，已保留当前内容')
    const doc = { ...(entry.doc || {}) }
    delete doc._id
    await ref.set({ ...doc, coupleId })
    await transaction.collection('trash').doc(id).remove()
  })
}

/** 彻底删除（回忆会连带删除照片文件）。 */
async function purgeEntry(id, coupleId, userId) {
  const entry = await db.runTransaction(async (transaction) => {
    const current = await transactionEntry(transaction, coupleId, userId, id)
    if (!current) return null
    await transaction.collection('trash').doc(id).update({ purging: true })
    return current
  })
  if (!entry) return
  if (entry.kind === 'memory') {
    // Never remove a file still used by a live memory or another archive.
    const retained = new Set()
    for (const collection of ['memories', 'trash']) {
      for (let offset = 0; ; offset += 100) {
        const response = await db.collection(collection).where({ coupleId }).skip(offset).limit(100).get()
        const docs = response.data || []
        for (const doc of docs) if (!(collection === 'trash' && doc._id === id)) {
          for (const file of fileIDsOf(collection === 'trash' ? doc.doc : doc)) retained.add(file)
        }
        if (docs.length < 100) break
      }
    }
    await deleteFiles(fileIDsOf(entry.doc).filter((file) => !retained.has(file)))
  }
  await db.runTransaction(async (transaction) => {
    const current = await transactionEntry(transaction, coupleId, userId, id)
    let receipt
    let recorded
    if (current?.kind === 'message') {
      receipt = transaction.collection('message_receipts').doc(current.originalId)
      recorded = docData(await receipt.get())
    }
    if (receipt && !recorded) {
      const doc = current.doc || {}
      const requestHash = createHash('sha256').update(JSON.stringify([coupleId,current.originalId,doc.createdBy,String(doc.text || '').trim(),doc.revealAt || null])).digest('hex')
      await receipt.set({ coupleId, createdBy: doc.createdBy, requestHash })
    }
    if (current && current.purging) await transaction.collection('trash').doc(id).remove()
  })
}

async function listTrash(coupleId, userId, now) {
  // 懒清理：超过 30 天的条目直接彻底删除（含文件），不留副本
  const expired = []
  const entries = []
  let skip = 0
  for (;;) {
    const page = await db.collection('trash').where({ coupleId }).skip(skip).limit(100).get()
    const docs = page.data || []
    for (const doc of docs) {
      if (visibleEntry(doc, userId) && expiry(doc) <= now) expired.push(doc)
      else if (visibleEntry(doc, userId)) entries.push(doc)
    }
    if (docs.length < 100) break
    skip += 100
  }
  for (const entry of expired) {
    try { await purgeEntry(entry._id, coupleId, userId) }
    catch (error) { console.warn('过期回收站清理未完成，将在下次读取时重试', error) }
  }

  return entries.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
    .slice(0, MAX_TRASH).map(publicItem)
}

exports.main = async (event = {}) => {
  const userId = await currentUserId()
  if (!userId) return { ok: false, code: 'UNAUTHENTICATED', message: '登录状态无效，请重新登录' }

  try {
    const action = String(event.action || '')
    const coupleId = requiredId(event.coupleId, '情侣空间 ID')
    await requireMember(userId, coupleId)

    if (action === 'list') {
      return { ok: true, items: await listTrash(coupleId, userId, Date.now()) }
    }

    if (action === 'restore' || action === 'purge') {
      const trashId = requiredId(event.trashId, '回收站条目 ID')
      if (action === 'restore') {
        await restoreEntry(trashId, coupleId, userId)
      } else {
        await purgeEntry(trashId, coupleId, userId)
      }
      return { ok: true }
    }

    return { ok: false, code: 'UNKNOWN_ACTION', message: '未知回收站操作' }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('trashAccess 执行失败', error)
    return { ok: false, code: 'INTERNAL', message: '回收站服务暂时不可用，请稍后重试' }
  }
}
