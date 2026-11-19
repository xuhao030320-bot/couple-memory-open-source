function documentFrom(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  if (data && typeof data === 'object') return data
  return null
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function isAuthorizedMember(couple, member, coupleId, userId) {
  const memberId = `${coupleId}_${userId}`
  const memberIds = couple && Array.isArray(couple.memberIds) ? couple.memberIds.map(String) : []
  return Boolean(
    couple
    && member
    && String(couple._id || '') === coupleId
    && memberIds.includes(userId)
    && String(member._id || '') === memberId
    && String(member.coupleId || '') === coupleId
    && String(member.userId || '') === userId
  )
}

module.exports = { documentFrom, isAuthorizedMember, isValidDate }
