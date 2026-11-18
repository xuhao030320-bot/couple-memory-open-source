// 留言安全网关：只有云函数读写 messages 原文。
// 必须与数据库规则配合：messages 的客户端 read/write 都设为 false。
// 发送者始终可见自己的内容；接收者在 revealAt 之前完全拿不到 text/replies。
const cloudbase = require('@cloudbase/node-sdk')
const { createHash } = require('node:crypto')
const {
  canViewMessage,
  normalizeId,
  normalizeRevealAt,
  normalizeText,
  visibleMessages,
} = require('./logic')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const PAGE_SIZE = 100
const MAX_MESSAGES = 1000

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
    console.warn('messageAccess 查询账号绑定关系失败', error)
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
    console.warn('messageAccess getUserInfo 失败', error)
    return ''
  }
}

function docData(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' && Object.keys(data).length ? data : null
}

function requiredId(value, fieldName) {
  try {
    return normalizeId(value)
  } catch {
    throw new AccessError('INVALID_INPUT', `${fieldName}格式不正确`)
  }
}

function requiredText(value) {
  try {
    return normalizeText(value)
  } catch {
    throw new AccessError('INVALID_TEXT', '内容需要 1 到 500 个字')
  }
}

function revealTime(value) {
  try {
    return normalizeRevealAt(value)
  } catch {
    throw new AccessError('INVALID_REVEAL_AT', '揭晓时间格式不正确')
  }
}

async function requireMember(userId, coupleId) {
  const result = await db.collection('couples').doc(coupleId).get().catch(() => null)
  const couple = docData(result)
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)) {
    throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
  }

  // 同时核对成员映射，不信任任一张表的单边数据。
  const membership = await db.collection('couple_members')
    .where({ coupleId, userId })
    .limit(1)
    .get()
  if (!membership.data || membership.data.length === 0) {
    throw new AccessError('FORBIDDEN', '情侣空间成员信息不完整')
  }
  return couple
}

async function listMessages(coupleId, userId) {
  const docs = []
  for (let skip = 0; skip < MAX_MESSAGES; skip += PAGE_SIZE) {
    const response = await db.collection('messages')
      .where({ coupleId })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const page = response.data || []
    docs.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return visibleMessages(docs, userId)
}

async function touchCouple(coupleId) {
  // 触发两端对 couples 的安全实时监听；即使通知写入失败，主操作也不应被重复执行。
  await db.collection('couples').doc(coupleId).update({
    messageUpdatedAt: db.serverDate(),
  }).catch((error) => console.warn('留言已写入，但实时通知标记失败', error))
}

async function transactionMember(transaction, coupleId, userId) {
  const couple = docData(await transaction.collection('couples').doc(coupleId).get())
  const member = docData(await transaction.collection('couple_members').doc(`${coupleId}_${userId}`).get())
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)
    || !member || member.coupleId !== coupleId || member.userId !== userId) throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
}

function requestHash(coupleId, messageId, createdBy, text, revealAt) {
  return createHash('sha256').update(JSON.stringify([coupleId,messageId,createdBy,text.trim(),revealAt || null])).digest('hex')
}

async function createMessage(event, coupleId, userId) {
  const messageId = requiredId(event.messageId, '留言 ID')
  const text = requiredText(event.text)
  const revealAt = revealTime(event.revealAt)
  const createdAt = new Date().toISOString()

  await db.runTransaction(async (transaction) => {
    await transactionMember(transaction, coupleId, userId)
    const ref = transaction.collection('messages').doc(messageId)
    const existing = docData(await ref.get())
    const trash = docData(await transaction.collection('trash').doc(`message_${messageId}`).get())
    const receiptRef = transaction.collection('message_receipts').doc(messageId)
    const receipt = docData(await receiptRef.get())
    const hash = requestHash(coupleId,messageId,userId,text,revealAt)
    const previous = existing || trash?.doc
    if (previous) {
      if (previous.coupleId !== coupleId || previous.createdBy !== userId || previous.text !== text
        || (previous.revealAt || null) !== revealAt) throw new AccessError('REQUEST_CONFLICT', '同一条留言的重试内容不一致，请刷新后重试')
      return // An acknowledged retry never changes timestamps or resurrects trash.
    }
    if (receipt) {
      if (receipt.coupleId !== coupleId || receipt.createdBy !== userId || receipt.requestHash !== hash) throw new AccessError('REQUEST_CONFLICT', '同一条留言的重试内容不一致，请刷新后重试')
      return
    }
    await receiptRef.set({ coupleId, createdBy: userId, requestHash: hash })
    await ref.set({ coupleId, createdBy: userId, text, revealAt, replies: [], createdAt, updatedAt: createdAt })
  })
  await touchCouple(coupleId)
}

async function appendReply(event, coupleId, userId) {
  const messageId = requiredId(event.messageId, '留言 ID')
  const replyId = requiredId(event.replyId, '回复 ID')
  const text = requiredText(event.text)
  await db.runTransaction(async (transaction) => {
  await transactionMember(transaction, coupleId, userId)
  const ref = transaction.collection('messages').doc(messageId)
  const message = docData(await ref.get())
  if (!message || String(message.coupleId || '') !== coupleId) {
    throw new AccessError('NOT_FOUND', '没有找到这条留言')
  }
  if (!canViewMessage(message, userId)) {
    throw new AccessError('MESSAGE_LOCKED', '这条留言还没有到揭晓时间')
  }

  const replies = Array.isArray(message.replies) ? message.replies : []
  const previous = replies.find((item) => item.id === replyId)
  if (previous) {
    if (previous.createdBy !== userId || previous.text !== text) throw new AccessError('REQUEST_CONFLICT', '同一条回复的重试内容不一致，请刷新后重试')
    return
  }

  const reply = {
    id: replyId,
    createdBy: userId,
    text,
    createdAt: new Date().toISOString(),
  }
  await ref.update({
    replies: [...replies, reply],
    updatedAt: reply.createdAt,
  })
  })
  await touchCouple(coupleId)
}

async function deleteMessage(event, coupleId, userId) {
  const messageId = requiredId(event.messageId, '留言 ID')
  await db.runTransaction(async (transaction) => {
  await transactionMember(transaction, coupleId, userId)
  const ref = transaction.collection('messages').doc(messageId)
  const message = docData(await ref.get())
  const trash = transaction.collection('trash').doc(`message_${messageId}`)
  const prior = docData(await trash.get())
  const receipt = transaction.collection('message_receipts').doc(messageId)
  const recorded = docData(await receipt.get())
  if (!message && prior?.coupleId === coupleId && prior.doc?.createdBy === userId) return
  if (!message || String(message.coupleId || '') !== coupleId) {
    throw new AccessError('NOT_FOUND', '没有找到这条留言')
  }
  if (String(message.createdBy || '') !== userId) {
    throw new AccessError('FORBIDDEN', '只能删除自己发送的留言')
  }
  // 删除 = 移入回收站（trashAccess 负责 30 天保留、恢复与彻底清理）
  const clean = { ...message }
  delete clean._id
  if (prior && prior.coupleId !== coupleId) throw new AccessError('FORBIDDEN', '回收站空间信息不一致')
  const deletedAt = new Date().toISOString()
  if (!recorded) await receipt.set({ coupleId, createdBy: message.createdBy, requestHash: requestHash(coupleId,messageId,message.createdBy,message.text,message.revealAt) })
  await trash.set({
    coupleId,
    kind: 'message',
    originalId: messageId,
    doc: { ...clean, coupleId },
    deletedBy: userId,
    deletedAt,
    expiresAt: new Date(Date.parse(deletedAt) + 30 * 86400000).toISOString(),
  })
  await ref.remove()
  })
  await touchCouple(coupleId)
}

exports.main = async (event = {}) => {
  const userId = await currentUserId()
  if (!userId) return { ok: false, code: 'UNAUTHENTICATED', message: '登录状态无效，请重新登录' }

  try {
    const action = String(event.action || '')
    const coupleId = requiredId(event.coupleId, '情侣空间 ID')
    await requireMember(userId, coupleId)

    if (action === 'list') {
      return { ok: true, messages: await listMessages(coupleId, userId) }
    }
    if (action === 'create') {
      await createMessage(event, coupleId, userId)
      return { ok: true }
    }
    if (action === 'reply') {
      await appendReply(event, coupleId, userId)
      return { ok: true }
    }
    if (action === 'delete') {
      await deleteMessage(event, coupleId, userId)
      return { ok: true }
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: '未知留言操作' }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('messageAccess 执行失败', error)
    return { ok: false, code: 'INTERNAL', message: '留言服务暂时不可用，请稍后重试' }
  }
}
