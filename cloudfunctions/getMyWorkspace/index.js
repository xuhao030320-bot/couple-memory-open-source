// 云函数：查询当前用户所在的情侣空间
// 双端共用：小程序调用身份 = openid，网页版（自定义登录）调用身份 = customUserId。
// P7 绑定（方案 C）：openid 已绑定网页版账号时，身份统一归一为 customUserId；
// memberIds 里可能同时存在 openid 别名与 customUserId（安全规则按 memberIds 校验双端客户端直读），
// 本函数返回时按绑定关系去重，客户端拿到的始终是「一人一个 id」。
const cloudbase = require('@cloudbase/node-sdk')
const { findValidWorkspace } = require('./workspace')
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
    console.warn('getUserInfo 失败', error)
    return ''
  }
}

/**
 * 按绑定关系去掉别名：memberIds 里的 openid 若绑定了同样在 memberIds 里的 customUserId，
 * 只保留 customUserId（保持原顺序，personA/personB 语义不变）。
 */
async function dedupeMemberIds(memberIds) {
  if (memberIds.length <= 1) return memberIds
  try {
    const result = await db.collection('users')
      .where({ openId: db.command.in(memberIds) })
      .limit(100)
      .get()
    const aliasOf = new Map()
    for (const doc of (Array.isArray(result.data) ? result.data : [])) {
      if (doc && doc._id) aliasOf.set(String(doc.openId || ''), String(doc._id))
    }
    if (aliasOf.size === 0) return memberIds
    const inSet = new Set(memberIds)
    return memberIds.filter((id) => {
      const canonical = aliasOf.get(id)
      return !(canonical && canonical !== id && inSet.has(canonical))
    })
  } catch (error) {
    console.warn('成员别名去重失败，返回原始列表', error)
    return memberIds
  }
}

exports.main = async () => {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, message: '登录状态无效，请重新登录后再试' }
  }

  const workspace = await findValidWorkspace(db, userId)
  if (!workspace) {
    return { ok: true, couple: null }
  }
  const { member, couple } = workspace
  const rawMemberIds = Array.isArray(couple.memberIds) ? couple.memberIds.map(String) : []
  const memberIds = await dedupeMemberIds(rawMemberIds)
  return {
    ok: true,
    couple: {
      coupleId: couple._id,
      inviteCode: couple.inviteCode,
      startDate: couple.startDate,
      memberIds,
      // 人数按去重后的成员算（绑定用户双 id 只算一个人）。
      memberCount: memberIds.length,
    },
    me: {
      displayName: member.displayName,
      userId,
    },
  }
}
