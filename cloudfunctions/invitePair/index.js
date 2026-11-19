// 云函数：创建情侣空间（8 位邀请码）+ 第一位成员
// 双端共用：小程序调用身份 = openid，网页版（自定义登录）调用身份 = customUserId，
// 两种身份字符串在 memberIds 里共存，网页用户与小程序用户可以进入同一个空间。
const { randomInt, randomBytes } = require('node:crypto')
const cloudbase = require('@cloudbase/node-sdk')
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混淆的 I/O/0/1
const CODE_LENGTH = 8

function generateInviteCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)]
  }
  return code
}

/** openid 若已绑定网页版账号，返回对应的 customUserId；否则返回空串。 */
async function resolveBoundCustomUserId(openId) {
  try {
    const result = await db.collection('users').where({ openId }).limit(1).get()
    const doc = Array.isArray(result.data) ? result.data[0] : (result.data || null)
    return doc && doc._id ? String(doc._id) : ''
  } catch (error) {
    console.warn('查询账号绑定关系失败', error)
    return ''
  }
}

/** 查询 customUserId 已绑定的 openid 别名（网页端调用时 auth 里没有 openid，只能查 users 文档）。 */
async function boundOpenIdOf(userId) {
  try {
    const result = await db.collection('users').doc(userId).get()
    const doc = Array.isArray(result.data) ? result.data[0] : (result.data || null)
    return String((doc && doc.openId) || '')
  } catch {
    return ''
  }
}

/**
 * 当前调用者身份（绑定归一）+ openid 别名。
 * 安全规则不允许改动：小程序客户端直读依赖 auth.openid ∈ memberIds，
 * 网页客户端直读依赖 auth.uid ∈ memberIds，所以新空间必须同时放行这两个 id。
 */
async function callerIdentity() {
  try {
    const info = app.auth().getUserInfo()
    if (info.isAnonymous) return { userId: '', openId: '' }
    // 注意：自定义登录时 customUserId 字段可能为空串，真实身份落在 uid（与 currentUserId 兜底链一致）。
    const customUserId = info.customUserId || (!info.openId ? String(info.uid || '') : '')
    if (customUserId) {
      return { userId: customUserId, openId: await boundOpenIdOf(customUserId) }
    }
    const openId = info.openId || ''
    if (openId) {
      const bound = await resolveBoundCustomUserId(openId)
      return { userId: bound || openId, openId }
    }
    return { userId: '', openId: '' }
  } catch (error) {
    console.warn('getUserInfo 失败', error)
    return { userId: '', openId: '' }
  }
}

exports.main = async (event) => {
  const { userId, openId } = await callerIdentity()
  if (!userId) {
    return { ok: false, message: '登录状态无效，请重新登录后再试' }
  }

  const displayName = String(event.displayName || '').trim().slice(0, 20) || '我'
  const startDate = String(event.startDate || '').slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { ok: false, message: '开始日期格式不正确' }
  }

  // 一个账号只能在一个空间里
  const existing = await db.collection('couple_members').where({ userId }).count()
  if (existing.total > 0) {
    return { ok: false, message: '你已经在一个情侣空间里了' }
  }

  // 生成不重复的邀请码（最多重试 5 次）
  let inviteCode = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    inviteCode = generateInviteCode()
    const clash = await db.collection('couples').where({ inviteCode }).count()
    if (clash.total === 0) break
    inviteCode = ''
  }
  if (!inviteCode) {
    return { ok: false, message: '邀请码生成失败，请重试' }
  }

  const now = db.serverDate()
  const coupleId = `cp_${Date.now()}_${randomBytes(5).toString('hex')}`
  // memberIds 放归一身份；已绑定用户再补一个 openid 别名，保证小程序端客户端直读不被安全规则拦截。
  const memberIds = [userId]
  if (openId && openId !== userId) memberIds.push(openId)
  const couple = {
    inviteCode,
    startDate,
    memberIds,
    memberCount: 1,
    createdAt: now,
    updatedAt: now,
  }
  const member = {
    coupleId,
    userId,
    displayName,
    joinedAt: now,
  }

  await db.runTransaction(async (tx) => {
    await tx.collection('couples').doc(coupleId).set(couple)
    await tx.collection('couple_members').doc(`${coupleId}_${userId}`).set(member)
  })

  return { ok: true, coupleId, inviteCode }
}
