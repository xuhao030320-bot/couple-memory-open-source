const PAGE_SIZE = 100

/** doc().get() 在不同 SDK 入口下可能返回对象或单元素数组。 */
function documentFrom(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  if (data && typeof data === 'object') return data
  return null
}

function isCanonicalMembership(member, couple, userId) {
  if (!member || !couple || !userId) return false
  const coupleId = String(member.coupleId || '')
  const memberIds = Array.isArray(couple.memberIds) ? couple.memberIds.map(String) : []
  return Boolean(
    coupleId
    && String(member.userId || '') === userId
    && String(member._id || '') === `${coupleId}_${userId}`
    && String(couple._id || '') === coupleId
    && memberIds.includes(userId)
  )
}

async function coupleForMembership(db, member, userId) {
  const coupleId = String(member && member.coupleId || '')
  if (
    !coupleId
    || coupleId.length > 128
    || coupleId.includes('/')
    || String(member && member._id || '') !== `${coupleId}_${userId}`
  ) return null

  try {
    const result = await db.collection('couples').doc(coupleId).get()
    const couple = documentFrom(result)
    return isCanonicalMembership(member, couple, userId) ? couple : null
  } catch {
    // 单条历史脏记录不可阻断后续真实成员关系的检查。
    return null
  }
}

/**
 * 查完调用者的全部成员映射，并逐条与 couples.memberIds 反向核对。
 * 旧规则曾允许用户创建指向任意 coupleId 的伪记录；不能用 limit(1)，否则一条
 * 历史脏数据就可能挡住后面的真实成员记录。
 */
async function findValidWorkspace(db, userId) {
  let skip = 0
  for (;;) {
    const result = await db.collection('couple_members')
      .where({ userId })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const members = Array.isArray(result.data) ? result.data : []

    // 一般只有一条记录；并发校验可避免历史脏数据较多时逐次往返。
    const couples = await Promise.all(members.map((member) => coupleForMembership(db, member, userId)))
    const index = couples.findIndex(Boolean)
    if (index >= 0) return { member: members[index], couple: couples[index] }

    if (members.length < PAGE_SIZE) return null
    skip += PAGE_SIZE
  }
}

module.exports = {
  PAGE_SIZE,
  documentFrom,
  findValidWorkspace,
  isCanonicalMembership,
}
