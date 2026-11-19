// 云函数：第二位成员凭 8 位邀请码加入情侣空间
// 邀请码一次性使用、最多两人、防重复加入；
// 双端共用：小程序调用身份 = openid，网页版（自定义登录）调用身份 = customUserId。
const cloudbase = require('@cloudbase/node-sdk')
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

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
 * 网页客户端直读依赖 auth.uid ∈ memberIds，所以加入后必须同时放行这两个 id。
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

  const inviteCode = String(event.inviteCode || '').trim().toUpperCase()
  const displayName = String(event.displayName || '').trim().slice(0, 20) || 'TA'

  if (!/^[A-Z2-9]{8}$/.test(inviteCode)) {
    return { ok: false, message: '邀请码是 8 位字母和数字，再核对一下' }
  }

  // 一个账号只能在一个空间里
  const already = await db.collection('couple_members').where({ userId }).count()
  if (already.total > 0) {
    return { ok: false, message: '你已经在一个情侣空间里了' }
  }

  const match = await db.collection('couples').where({ inviteCode }).limit(1).get()
  if (match.data.length === 0) {
    return { ok: false, message: '邀请码不存在，让对方再发一次' }
  }
  const coupleId = match.data[0]._id
  return db.runTransaction(async (tx) => {
    const ref = tx.collection('couples').doc(coupleId)
    const result = await ref.get()
    const couple = Array.isArray(result.data) ? result.data[0] : result.data
    if (!couple || couple.inviteCode !== inviteCode) return { ok: false, message: '邀请码无效' }
    if (couple.memberCount !== 1 || !Array.isArray(couple.memberIds) || couple.memberIds.includes(userId)) {
      return { ok: false, message: '这个空间已经加入过或已有两个人了' }
    }

    const memberIds = [...new Set([...couple.memberIds, userId, ...(openId ? [openId] : [])])]
    const now = db.serverDate()
    await tx.collection('couple_members').doc(`${coupleId}_${userId}`).set({
      coupleId, userId, displayName, joinedAt: now,
    })
    await ref.update({ memberIds, memberCount: 2, updatedAt: now })
    return { ok: true, coupleId }
  })
}
