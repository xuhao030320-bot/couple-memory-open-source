// 云函数：只允许当前登录者更新自己的昵称，以及所在空间的开始日期。
// couples / couple_members 已禁止客户端直写，所有资料修改由这里完成鉴权。
const cloudbase = require('@cloudbase/node-sdk')
const { documentFrom, isAuthorizedMember, isValidDate } = require('./profile')
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

exports.main = async (event) => {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, message: '登录状态无效，请重新登录后再试' }
  }

  const coupleId = String(event && event.coupleId || '').trim()
  const displayName = String(event && event.displayName || '').trim()
  const startDate = String(event && event.startDate || '').trim()

  if (!coupleId || coupleId.length > 128 || coupleId.includes('/')) {
    return { ok: false, message: '情侣空间参数无效' }
  }
  if (!displayName || displayName.length > 20) {
    return { ok: false, message: '昵称需要填写，且不能超过 20 个字符' }
  }
  if (!isValidDate(startDate)) {
    return { ok: false, message: '开始日期格式不正确' }
  }

  const memberId = `${coupleId}_${userId}`
  return db.runTransaction(async (tx) => {
    const coupleRef = tx.collection('couples').doc(coupleId)
    const memberRef = tx.collection('couple_members').doc(memberId)
    const couple = documentFrom(await coupleRef.get())
    const member = documentFrom(await memberRef.get())
    if (!isAuthorizedMember(couple, member, coupleId, userId)) {
      return { ok: false, message: '你不是这个情侣空间的成员' }
    }
    await coupleRef.update({ startDate, updatedAt: db.serverDate() })
    await memberRef.update({ displayName })
    return { ok: true, displayName, startDate }
  })
}
