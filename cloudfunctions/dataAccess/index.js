// 回忆/愿望/纪念日 写入安全网关：客户端对这三张表的写入一律被安全规则拒绝，
// 所有新增/修改/删除由这里完成成员鉴权后以服务端身份写库。
// 读取仍走客户端直读（安全规则按 coupleId 校验成员身份）。
// 与 messageAccess / updateMyProfile 同一模式：auth().getUserInfo() 取 customUserId，
// 再对 couples.memberIds + couple_members 双重核对。
const cloudbase = require('@cloudbase/node-sdk')
const { createHash, randomUUID } = require('node:crypto')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SYNC_WISHES = 200
const MAX_SYNC_HOTELS = 200
const MAX_TEXT_LENGTH = 500
const PARTNER_NOTES_MIGRATION_VERSION = 1
const PARTNER_NOTES_MIGRATION_BATCH = 30

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
    console.warn('dataAccess 查询账号绑定关系失败', error)
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
    console.warn('dataAccess getUserInfo 失败', error)
    return ''
  }
}

function docData(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' && Object.keys(data).length ? data : null
}

function requiredId(value, fieldName) {
  const id = String(value || '')
  if (!ID_PATTERN.test(id)) {
    throw new AccessError('INVALID_INPUT', `${fieldName}格式不正确`)
  }
  return id
}

function requiredText(value, label, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').trim()
  if (!text || text.length > maxLength) {
    throw new AccessError('INVALID_INPUT', `${label}需要填写，且不能超过 ${maxLength} 个字`)
  }
  return text
}

function optionalText(value, label, maxLength) {
  const text = String(value || '').trim()
  if (text.length > maxLength) {
    throw new AccessError('INVALID_INPUT', `${label}涓嶈兘瓒呰繃 ${maxLength} 涓瓧`)
  }
  return text
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

/** 客户端传上来的 doc 一律剥掉 _id/coupleId，由服务端以校验过的值重写，防止越权写进别的空间。 */
function sanitizeDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new AccessError('INVALID_INPUT', '写入数据格式不正确')
  }
  const clean = { ...doc }
  delete clean._id
  delete clean.coupleId
  return clean
}

/** 删除 = 移入回收站（trashAccess 负责 30 天保留、恢复与彻底清理），照片文件随条目保留。 */
async function moveToTrash(kind, originalId, doc, coupleId, userId, writer = db) {
  const clean = { ...(doc || {}) }
  delete clean._id
  delete clean.coupleId
  const trash = writer.collection('trash').doc(`${kind}_${originalId}`)
  const previous = docData(await trash.get())
  if (previous && previous.coupleId !== coupleId) throw new AccessError('FORBIDDEN', '回收站空间信息不一致')
  const deletedAt = new Date().toISOString()
  await trash.set({
    coupleId,
    kind,
    originalId,
    doc: { ...clean, coupleId },
    deletedBy: userId,
    deletedAt,
    expiresAt: new Date(Date.parse(deletedAt) + 30 * 86400000).toISOString(),
  })
}

async function removeStoredEntry(kind, collection, id, coupleId, userId) {
  return db.runTransaction(async (transaction) => {
    await partnerNoteMember(transaction, coupleId, userId)
    const ref = transaction.collection(collection).doc(id)
    const doc = docData(await ref.get())
    if (!doc) {
      const prior = docData(await transaction.collection('trash').doc(`${kind}_${id}`).get())
      if (prior && prior.coupleId === coupleId) return
      throw new AccessError('NOT_FOUND', '没有找到这条内容')
    }
    if (doc.coupleId !== coupleId) throw new AccessError('NOT_FOUND', '没有找到这条内容')
    await moveToTrash(kind, id, doc, coupleId, userId, transaction)
    const result = await ref.remove()
    if (result.deleted === 0) throw new AccessError('NOT_FOUND', '没有找到这条内容')
  })
}

async function putMemory(event, coupleId) {
  const memoryId = requiredId(event.memoryId, '回忆 ID')
  const doc = sanitizeDoc(event.doc)
  requiredText(doc.title, '标题', 60)
  await db.collection('memories').doc(memoryId).set({ ...doc, coupleId })
}

async function removeMemory(event, coupleId, userId) {
  const memoryId = requiredId(event.memoryId, '回忆 ID')
  await removeStoredEntry('memory', 'memories', memoryId, coupleId, userId)
}

async function createAnniversary(event, coupleId) {
  const anniversaryId = requiredId(event.anniversaryId, '纪念日 ID')
  const doc = sanitizeDoc(event.doc)
  requiredText(doc.title, '标题', 60)
  await db.collection('anniversaries').doc(anniversaryId).set({ ...doc, coupleId })
}

async function updateAnniversary(event, coupleId) {
  const anniversaryId = requiredId(event.anniversaryId, '纪念日 ID')
  const patch = sanitizeDoc(event.patch)
  if (patch.title !== undefined) requiredText(patch.title, '标题', 60)
  const existing = await db.collection('anniversaries').doc(anniversaryId).get().catch(() => null)
  const anniversary = docData(existing)
  if (!anniversary || String(anniversary.coupleId || '') !== coupleId) {
    throw new AccessError('NOT_FOUND', '没有找到这个纪念日')
  }
  await db.collection('anniversaries').doc(anniversaryId).update(patch)
}

async function removeAnniversary(event, coupleId, userId) {
  const anniversaryId = requiredId(event.anniversaryId, '纪念日 ID')
  await removeStoredEntry('anniversary', 'anniversaries', anniversaryId, coupleId, userId)
}

async function syncWishes(event, coupleId, userId) {
  const created = Array.isArray(event.created) ? event.created : []
  const updated = Array.isArray(event.updated) ? event.updated : []
  const removed = Array.isArray(event.removed) ? event.removed : []
  if (created.length + updated.length + removed.length > MAX_SYNC_WISHES) {
    throw new AccessError('INVALID_INPUT', '一次同步的愿望太多了')
  }

  for (const item of created) {
    const wishId = requiredId(item && item.id, '愿望 ID')
    const doc = sanitizeDoc(item.doc || item)
    requiredText(doc.text, '愿望内容')
    await db.collection('wishes').doc(wishId).set({ ...doc, coupleId })
  }
  for (const item of updated) {
    const wishId = requiredId(item && item.id, '愿望 ID')
    const patch = sanitizeDoc(item && item.patch)
    if (patch.text !== undefined) requiredText(patch.text, '愿望内容')
    await db.collection('wishes').doc(wishId).update(patch)
  }
  for (const id of removed) {
    const wishId = requiredId(id, '愿望 ID')
    await removeStoredEntry('wish', 'wishes', wishId, coupleId, userId)
  }
}

async function saveMessageNotes(event, coupleId) {
  const notes = event.notes && typeof event.notes === 'object' ? event.notes : {}
  await db.collection('couple_notes').doc(coupleId).set({
    coupleId,
    likes: optionalText(notes.likes, '喜欢备忘', 1000),
    dislikes: optionalText(notes.dislikes, '不喜欢备忘', 1000),
    updatedAt: new Date().toISOString(),
  })
}

function partnerNoteInput(event) {
  const note = event.note
  if (!note || typeof note !== 'object' || Array.isArray(note)
    || typeof note.text !== 'string' || !note.text.trim() || note.text.trim().length > 1000
    || !['like', 'care'].includes(note.kind)) {
    throw new AccessError('INVALID_INPUT', '备忘需要填写内容，最多 1000 个字，并选择正确的分类')
  }
  return { text: note.text.trim(), kind: note.kind }
}

function partnerNoteRecord(doc) {
  return {
    id: String(doc._id), text: doc.text, kind: doc.kind,
    createdAt: doc.legacy === true ? null : (typeof doc.createdAt === 'string' ? doc.createdAt : null),
    ...(typeof doc.createdBy === 'string' ? { createdBy: doc.createdBy } : {}),
    ...(doc.legacy === true ? { legacy: true } : {}),
    ...(doc.pinned === true ? { pinned: true } : {}),
  }
}

async function partnerNoteMember(transaction, coupleId, userId) {
  const couple = docData(await transaction.collection('couples').doc(coupleId).get())
  const member = docData(await transaction.collection('couple_members').doc(`${coupleId}_${userId}`).get())
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)
    || !member || member.coupleId !== coupleId || member.userId !== userId) {
    throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
  }
  return couple
}

function legacyPartnerNotes(coupleId, source) {
  const entries = []
  for (const [field, kind] of [['likes', 'like'], ['dislikes', 'care']]) {
    const lines = typeof source?.[field] === 'string' ? source[field].split(/\r\n|\n|\r/) : []
    for (const [index, line] of lines.entries()) {
      const text = line.trim()
      if (!text) continue
      const hash = createHash('sha256').update(`${coupleId}\0${kind}\0${index}`).digest('hex').slice(0, 40)
      entries.push({ id: `legacy_${hash}`, text, kind })
    }
  }
  return entries
}

async function migratePartnerNotes(coupleId, userId) {
  // The parent snapshot/cursor and each batch commit together. A completed cursor
  // never replays entries, including entries edited or deleted after migration.
  // Keep each transaction below the SDK's 100-operation/30-second limits.
  for (;;) {
    const done = await db.runTransaction(async (transaction) => {
      const couple = await partnerNoteMember(transaction, coupleId, userId)
      if (couple.partnerNotesMigrationVersion === PARTNER_NOTES_MIGRATION_VERSION) return true
      let state = couple.partnerNotesMigrationState
      if (!state || state.version !== PARTNER_NOTES_MIGRATION_VERSION) {
        const source = docData(await transaction.collection('couple_notes').doc(coupleId).get())
        if (source && source.coupleId !== coupleId) throw new AccessError('FORBIDDEN', '备忘空间信息不一致')
        state = { version: PARTNER_NOTES_MIGRATION_VERSION, entries: legacyPartnerNotes(coupleId, source), cursor: 0 }
      }
      const batch = state.entries.slice(state.cursor, state.cursor + PARTNER_NOTES_MIGRATION_BATCH)
      const pending = []
      for (const entry of batch) {
        const ref = transaction.collection('partner_notes').doc(entry.id)
        const existing = docData(await ref.get())
        if (existing && existing.coupleId !== coupleId) throw new AccessError('FORBIDDEN', '备忘空间信息不一致')
        if (!existing) pending.push({ ref, entry })
      }
      // Finish all reads before writes, matching the documented transaction examples.
      for (const { ref, entry } of pending) {
        await ref.set({ coupleId, text: entry.text, kind: entry.kind, createdAt: null, legacy: true })
      }
      const cursor = state.cursor + batch.length
      const complete = cursor >= state.entries.length
      await transaction.collection('couples').doc(coupleId).update(complete
        ? { partnerNotesMigrationVersion: PARTNER_NOTES_MIGRATION_VERSION, partnerNotesMigrationState: null }
        : { partnerNotesMigrationState: { ...state, cursor } })
      return complete
    })
    if (done) return
  }
}

async function listPartnerNotes(coupleId, userId) {
  await migratePartnerNotes(coupleId, userId)
  const records = []
  for (let offset = 0; ; offset += 100) {
    const { data } = await db.collection('partner_notes').where({ coupleId }).skip(offset).limit(100).get()
    const page = Array.isArray(data) ? data : []
    records.push(...page.map(partnerNoteRecord))
    if (page.length < 100) break
  }
  return records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.id.localeCompare(b.id))
}

async function createPartnerNote(event, coupleId, userId) {
  const input = partnerNoteInput(event)
  await migratePartnerNotes(coupleId, userId)
  const id = randomUUID()
  return db.runTransaction(async (transaction) => {
    await partnerNoteMember(transaction, coupleId, userId)
    const doc = { _id: id, coupleId, ...input, createdAt: new Date().toISOString(), createdBy: userId }
    await transaction.collection('partner_notes').doc(id).set({ coupleId, ...input, createdAt: doc.createdAt, createdBy: userId })
    return partnerNoteRecord(doc)
  })
}

async function changePartnerNote(event, coupleId, userId, remove) {
  const id = requiredId(event.noteId, '备忘 ID')
  const input = remove ? null : partnerNoteInput(event)
  await migratePartnerNotes(coupleId, userId)
  if (remove) return removeStoredEntry('partner_note', 'partner_notes', id, coupleId, userId)
  return db.runTransaction(async (transaction) => {
    await partnerNoteMember(transaction, coupleId, userId)
    const ref = transaction.collection('partner_notes').doc(id)
    const existing = docData(await ref.get())
    if (!existing || existing.coupleId !== coupleId) throw new AccessError('NOT_FOUND', '没有找到这条备忘，它可能已经被对方删除')
    // Whitelist editable fields; publication time and author always stay intact.
    const result = await ref.update(input)
    if (result.updated === 0) throw new AccessError('NOT_FOUND', '没有找到这条备忘')
    return partnerNoteRecord({ ...existing, ...input })
  })
}

async function setPartnerNotePinned(event, coupleId, userId) {
  const id = requiredId(event.noteId, '备忘 ID')
  if (typeof event.pinned !== 'boolean') throw new AccessError('INVALID_INPUT', '置顶状态格式不正确')
  await migratePartnerNotes(coupleId, userId)
  return db.runTransaction(async (transaction) => {
    await partnerNoteMember(transaction, coupleId, userId)
    const ref = transaction.collection('partner_notes').doc(id)
    const doc = docData(await ref.get())
    if (!doc || doc.coupleId !== coupleId) throw new AccessError('NOT_FOUND', '没有找到这条备忘')
    const result = await ref.update({ pinned: event.pinned })
    if (result.updated === 0) throw new AccessError('NOT_FOUND', '没有找到这条备忘')
    return partnerNoteRecord({ ...doc, pinned: event.pinned })
  })
}

function hotelDoc(eventDoc) {
  const doc = sanitizeDoc(eventDoc)
  const hotelName = requiredText(doc.hotelName, '酒店名称', 80)
  const city = optionalText(doc.city, '城市', 50)
  const review = optionalText(doc.review, '测评', 1000)
  const rating = Number(doc.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AccessError('INVALID_INPUT', '酒店评分必须是 1 到 5 星')
  }
  const stayedAt = String(doc.stayedAt || '')
  if (stayedAt && !/^\d{4}-\d{2}-\d{2}$/.test(stayedAt)) {
    throw new AccessError('INVALID_INPUT', '入住日期格式不正确')
  }
  return { hotelName, city, stayedAt, rating, review, createdAt: doc.createdAt || new Date().toISOString() }
}

async function syncHotelReviews(event, coupleId, userId) {
  const created = Array.isArray(event.created) ? event.created : []
  const updated = Array.isArray(event.updated) ? event.updated : []
  const removed = Array.isArray(event.removed) ? event.removed : []
  if (created.length + updated.length + removed.length > MAX_SYNC_HOTELS) {
    throw new AccessError('INVALID_INPUT', '一次同步的酒店测评太多了')
  }
  for (const item of created) {
    const reviewId = requiredId(item && item.id, '酒店测评 ID')
    const doc = hotelDoc(item && item.doc)
    await db.collection('hotel_reviews').doc(reviewId).set({ ...doc, coupleId, createdBy: userId })
  }
  for (const item of updated) {
    const reviewId = requiredId(item && item.id, '酒店测评 ID')
    const existing = await db.collection('hotel_reviews').doc(reviewId).get().catch(() => null)
    const current = docData(existing)
    if (!current || String(current.coupleId || '') !== coupleId) {
      throw new AccessError('NOT_FOUND', '没有找到这条酒店测评')
    }
    const patch = hotelDoc({ ...(current || {}), ...(item && item.patch) })
    delete patch.createdAt
    await db.collection('hotel_reviews').doc(reviewId).update(patch)
  }
  for (const id of removed) {
    const reviewId = requiredId(id, '酒店测评 ID')
    const existing = await db.collection('hotel_reviews').doc(reviewId).get().catch(() => null)
    const review = docData(existing)
    if (review && String(review.coupleId || '') === coupleId) await db.collection('hotel_reviews').doc(reviewId).remove()
  }
}

exports.main = async (event = {}) => {
  const userId = await currentUserId()
  if (!userId) return { ok: false, code: 'UNAUTHENTICATED', message: '登录状态无效，请重新登录' }

  try {
    const action = String(event.action || '')
    const coupleId = requiredId(event.coupleId, '情侣空间 ID')
    await requireMember(userId, coupleId)

    switch (action) {
      case 'putMemory':
        await putMemory(event, coupleId)
        return { ok: true }
      case 'removeMemory':
        await removeMemory(event, coupleId, userId)
        return { ok: true }
      case 'createAnniversary':
        await createAnniversary(event, coupleId)
        return { ok: true }
      case 'updateAnniversary':
        await updateAnniversary(event, coupleId)
        return { ok: true }
      case 'removeAnniversary':
        await removeAnniversary(event, coupleId, userId)
        return { ok: true }
      case 'syncWishes':
        await syncWishes(event, coupleId, userId)
        return { ok: true }
      case 'saveMessageNotes':
        await saveMessageNotes(event, coupleId)
        return { ok: true }
      case 'listPartnerNotes':
        return { ok: true, partnerNotes: await listPartnerNotes(coupleId, userId) }
      case 'createPartnerNote':
        return { ok: true, partnerNote: await createPartnerNote(event, coupleId, userId) }
      case 'updatePartnerNote':
        return { ok: true, partnerNote: await changePartnerNote(event, coupleId, userId, false) }
      case 'deletePartnerNote':
        await changePartnerNote(event, coupleId, userId, true)
        return { ok: true }
      case 'setPartnerNotePinned':
        return { ok: true, partnerNote: await setPartnerNotePinned(event, coupleId, userId) }
      case 'syncHotelReviews':
        await syncHotelReviews(event, coupleId, userId)
        return { ok: true }
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', message: '未知数据操作' }
    }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('dataAccess 执行失败', error)
    return { ok: false, code: 'INTERNAL', message: '数据服务暂时不可用，请稍后重试' }
  }
}
