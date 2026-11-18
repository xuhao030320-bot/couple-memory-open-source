import type {
  AnniversaryEntry,
  CloudWorkspace,
  CoupleProfile,
  MemoryEntry,
  MessageItem,
  MessageReply,
  MessageNotes,
  PartnerNote,
  PartnerNoteInput,
  PhotoAsset,
  WishItem,
} from '../../types'
import type { CloudSession, CloudUser, CloudWatchHandle, CloudTrashItem } from '../providers'
export type { CloudTrashItem } from '../providers'
import { inferMediaKind, normalizeMemory } from '../../features/memories/memory'
import {
  callCloudFunction,
  cloudbaseAuth,
  cloudbaseDb,
  deleteCloudFiles,
  tempUrlsFor,
  uploadCloudFile,
} from '../cloudbase'

const PAGE_SIZE = 100
const SESSION_META_KEY = 'only-us-cloud-session-meta'

interface SessionMeta {
  email: string
  displayName: string
}

interface WebAuthResponse {
  ok: boolean
  ticket?: string
  displayName?: string
  code?: string
  message?: string
}

interface MessageAccessResponse {
  ok: boolean
  messages?: Array<Record<string, unknown>>
  code?: string
  message?: string
}

interface DataAccessResponse {
  ok: boolean
  code?: string
  message?: string
  partnerNotes?: Array<Record<string, unknown>>
  partnerNote?: Record<string, unknown>
}

interface WorkspaceLookupResponse {
  ok: boolean
  message?: string
  couple?: { coupleId?: string; memberIds?: string[] } | null
  me?: { userId?: string }
}

interface CloudbaseLoginState {
  user?: {
    id?: string
    customUserId?: string
    uid?: string
    email?: string
    displayName?: string
    user_metadata?: {
      display_name?: string
      name?: string
      nickName?: string
    }
  } | null
}

interface PhotoDoc {
  id: string
  src: string
  fileID: string
  storagePath: string
  name: string
  alt: string
  caption: string
  order: number
  role: 'cover' | 'supporting'
  focusX: number
  focusY: number
  kind: 'image' | 'video'
  mimeType: string
}

/** 当前登录用户 id（customUserId）。由 getCloudSession / signIn / signUp 维护。 */
let activeUserId = ''

function readSessionMeta(): SessionMeta {
  try {
    const raw = window.localStorage.getItem(SESSION_META_KEY)
    return raw ? JSON.parse(raw) as SessionMeta : { email: '', displayName: '' }
  } catch {
    return { email: '', displayName: '' }
  }
}

function writeSessionMeta(meta: SessionMeta) {
  try {
    window.localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta))
  } catch {
    // 隐私模式等场景下 localStorage 不可用时不致命
  }
}

/** 清掉 SDK 的旧会话存储（保留本应用自己的 only-us-* 数据，如记住密码与草稿）。
 *  SDK 同时使用 localStorage 与 sessionStorage，两处都要清。 */
export function clearSdkSessionStorage() {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const preserved: Record<string, string> = {}
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (key && key.startsWith('only-us-')) preserved[key] = storage.getItem(key) || ''
      }
      storage.clear()
      for (const [key, value] of Object.entries(preserved)) storage.setItem(key, value)
    }
  } catch {
    // 隐私模式等场景下忽略
  }
}

function clearSessionMeta() {
  try {
    window.localStorage.removeItem(SESSION_META_KEY)
  } catch {
    // ignore
  }
}

function messageFromAuthCode(response: WebAuthResponse, fallback: string) {
  if (!response.ok) {
    if (response.code === 'INVALID_CREDENTIALS') return '邮箱或密码不正确'
    if (response.code === 'USER_EXISTS') return '这个邮箱已经注册，可以直接登录'
    if (response.code === 'EMAIL_NOT_CONFIRMED') return '请先打开验证邮件完成邮箱确认'
    return response.message || fallback
  }
  return fallback
}

function messageFromUnknown(error: unknown, fallback: string) {
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message
      ?? (error as { errMsg?: unknown }).errMsg
      ?? (error as { code?: unknown }).code
    if (candidate) return String(candidate)
    try {
      const dump = JSON.stringify(error, Object.getOwnPropertyNames(error))
      if (dump && dump !== '{}') return `${fallback}｜${dump.slice(0, 200)}`
    } catch {
      // ignore
    }
  }
  return fallback
}

function toCloudUser(
  id: string,
  email: string | null,
  displayName: string,
): CloudUser {
  return {
    id,
    email,
    // 同时填充两种形状，App.tsx 里的 user_metadata.display_name 读取在两种 provider 下都可用
    user_metadata: { display_name: displayName },
    userMetadata: { display_name: displayName },
  }
}

function mapLoginState(
  state: CloudbaseLoginState | null,
  fallbackEmail?: string,
  fallbackName?: string,
): CloudSession | null {
  const meta = readSessionMeta()
  const user = state?.user
  const id = String(user?.customUserId || user?.uid || user?.id || '')
  if (!id) return null
  const email = user?.email || fallbackEmail || meta.email || null
  const displayName = user?.displayName
    || user?.user_metadata?.display_name
    || user?.user_metadata?.name
    || user?.user_metadata?.nickName
    || fallbackName
    || meta.displayName
    || ''
  return { user: toCloudUser(id, email, displayName) }
}

/** 等待 SDK 会话真正切换完成：登录后立刻发请求可能还带着旧凭证（偶发身份错位）。 */
async function waitForSession(userId: string, timeoutMs = 3000): Promise<void> {
  if (!userId) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await cloudbaseAuth().hasLoginState() as CloudbaseLoginState | null
      const current = String(state?.user?.customUserId || state?.user?.uid || state?.user?.id || '')
      if (current === userId) return
    } catch {
      // 状态读取失败时继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function currentUserId() {
  if (activeUserId) return activeUserId
  try {
    const state = cloudbaseAuth().hasLoginState() as unknown as CloudbaseLoginState | null
    return String(state?.user?.customUserId || state?.user?.uid || state?.user?.id || '')
  } catch {
    return ''
  }
}

export async function signInWithEmail(email: string, password: string): Promise<CloudSession | null> {
  const auth = cloudbaseAuth()
  const normalized = email.trim().toLowerCase()
  let response: WebAuthResponse
  try {
    response = await callCloudFunction<WebAuthResponse>('webAuth', {
      action: 'login',
      email: normalized,
      password,
    })
  } catch (error) {
    throw new Error(messageFromUnknown(error, '认证服务暂时不可用，请稍后重试'))
  }
  if (!response.ok || !response.ticket) throw new Error(messageFromAuthCode(response, '登录失败'))
  let state: unknown
  try {
    // 同一设备切换账号时必须先清旧会话：SDK 可能保留上一个账号的凭证，
    // 否则会出现"客户端身份=A、网关身份=B"的错位（登录身份已变化）。
    // 只清会话不够时，把 SDK 的本地存储一并清掉（保留本应用自己的数据）。
    try { await auth.signOut() } catch { /* 旧会话不存在时忽略 */ }
    clearSdkSessionStorage()
    state = await auth.signInWithCustomTicket(async () => response.ticket as string)
    await waitForSession(String((state as { user?: { uid?: string } } | null)?.user?.uid || ''))
  } catch (error) {
    throw new Error(messageFromUnknown(error, '登录失败，请稍后重试'))
  }
  const session = mapLoginState(state as CloudbaseLoginState, normalized, response.displayName || '')
  if (!session) throw new Error('登录失败，请重试')
  activeUserId = session.user.id
  writeSessionMeta({ email: normalized, displayName: response.displayName || '' })
  // 新凭证已落盘，刷新一次让页面以全新状态加载——旧会话的内存残留随之作废
  window.setTimeout(() => window.location.reload(), 120)
  return session
}

export async function signUpWithEmail(
  displayName: string,
  email: string,
  password: string,
): Promise<{ user: CloudUser | null; session: CloudSession | null }> {
  const auth = cloudbaseAuth()
  const normalized = email.trim().toLowerCase()
  let response: WebAuthResponse
  try {
    response = await callCloudFunction<WebAuthResponse>('webAuth', {
      action: 'register',
      email: normalized,
      password,
      displayName: displayName.trim(),
    })
  } catch (error) {
    throw new Error(messageFromUnknown(error, '认证服务暂时不可用，请稍后重试'))
  }
  if (!response.ok || !response.ticket) throw new Error(messageFromAuthCode(response, '注册失败'))
  let state: unknown
  try {
    try { await auth.signOut() } catch { /* 旧会话不存在时忽略 */ }
    clearSdkSessionStorage()
    state = await auth.signInWithCustomTicket(async () => response.ticket as string)
    await waitForSession(String((state as { user?: { uid?: string } } | null)?.user?.uid || ''))
  } catch (error) {
    throw new Error(messageFromUnknown(error, '注册失败，请稍后重试'))
  }
  const session = mapLoginState(state as CloudbaseLoginState, normalized, displayName.trim())
  if (!session) throw new Error('注册失败，请重试')
  activeUserId = session.user.id
  writeSessionMeta({ email: normalized, displayName: displayName.trim() })
  window.setTimeout(() => window.location.reload(), 120)
  return { user: session.user, session }
}

export async function signOutCloud() {
  try {
    await cloudbaseAuth().signOut()
  } finally {
    activeUserId = ''
    clearSessionMeta()
  }
}

export async function getCloudSession(): Promise<CloudSession | null> {
  const state = await cloudbaseAuth().getLoginState()
  const session = mapLoginState(state as CloudbaseLoginState)
  if (session) activeUserId = session.user.id
  return session
}

/**
 * The v1 compatibility listener emits empty payloads for credential refresh
 * errors. Those errors are recoverable and must not clear the app session.
 */
export function shouldPropagateCloudbaseAuthEvent(
  event: unknown,
  session: CloudSession | null,
): boolean {
  return Boolean(session) || String(event || '').toUpperCase() === 'SIGNED_OUT'
}

export function onCloudAuthChange(callback: (session: CloudSession | null) => void): () => void {
  const auth = cloudbaseAuth()
  let disposed = false
  const { data } = auth.onAuthStateChange((event: unknown, state: unknown) => {
    if (disposed) return
    const session = mapLoginState(state as CloudbaseLoginState)
    if (!shouldPropagateCloudbaseAuthEvent(event, session)) return
    if (session) {
      activeUserId = session.user.id
    } else {
      activeUserId = ''
    }
    callback(session)
  })
  return () => {
    disposed = true
    data.subscription.unsubscribe()
  }
}

export async function createCloudCouple(displayName: string, startDate: string) {
  const response = await callCloudFunction<{ ok: boolean; message?: string }>('invitePair', {
    displayName: displayName.trim(),
    startDate,
  })
  if (!response.ok) throw new Error(response.message || '情侣空间创建失败')
}

export async function joinCloudCouple(displayName: string, inviteCode: string) {
  const response = await callCloudFunction<{ ok: boolean; message?: string }>('joinCouple', {
    displayName: displayName.trim(),
    inviteCode: inviteCode.trim().toUpperCase(),
  })
  if (!response.ok) throw new Error(response.message || '加入失败')
}

function asISO(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return ''
}

/** doc().get() 的 data 形态不一：管理端返回对象、网页端可能返回包着文档的数组，统一归一为对象。 */
function docData(result: { data?: unknown }): Record<string, unknown> {
  const data = result.data
  const isErrorPayload = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    return typeof record.code === 'string' && typeof record.message === 'string' && !('_id' in record)
  }
  if (isErrorPayload(data)) return {}
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0]
    return isErrorPayload(first) ? {} : first as Record<string, unknown>
  }
  return {}
}

function photoFromDoc(item: Record<string, unknown>): PhotoAsset {
  const fileID = String(item.fileID || item.src || item.storagePath || '')
  return {
    id: String(item.id || ''),
    src: fileID,
    name: String(item.name || ''),
    alt: String(item.alt || ''),
    caption: String(item.caption || ''),
    order: Number(item.order || 0),
    role: (item.role as 'cover' | 'supporting') || 'supporting',
    focusX: Number(item.focusX || 0),
    focusY: Number(item.focusY || 0),
    kind: (item.kind as 'image' | 'video') || inferMediaKind(String(item.mimeType || ''), String(item.name || '')),
    mimeType: String(item.mimeType || 'image/jpeg'),
    storagePath: fileID,
  }
}

/** 供单测使用；生产代码经门面调用，不会直接 import 这些映射函数。 */
export function toMemory(doc: Record<string, unknown>): MemoryEntry {
  return normalizeMemory({
    id: String(doc._id || ''),
    title: String(doc.title || ''),
    originalText: String(doc.originalText || ''),
    displayText: String(doc.displayText || ''),
    date: String(doc.date || ''),
    location: String(doc.location || ''),
    latitude: typeof doc.latitude === 'number' ? doc.latitude : undefined,
    longitude: typeof doc.longitude === 'number' ? doc.longitude : undefined,
    style: (doc.style as MemoryEntry['style']) || 'cream',
    template: (doc.template as MemoryEntry['template']) || 'hero-note',
    photos: Array.isArray(doc.photos) ? doc.photos.map((photo) => photoFromDoc(photo as Record<string, unknown>)) : [],
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    category: (doc.category as MemoryEntry['category']) || 'daily',
    moodEmoji: String(doc.moodEmoji || ''),
    moodText: String(doc.moodText || ''),
    themeColor: typeof doc.themeColor === 'string' ? doc.themeColor : undefined,
    createdAt: asISO(doc.createdAt),
    isDemo: Boolean(doc.isDemo),
    isLiked: Boolean(doc.isLiked),
  })
}

/** 供单测使用。 */
export function toWish(doc: Record<string, unknown>): WishItem {
  return {
    id: String(doc._id || ''),
    text: String(doc.text || ''),
    completed: Boolean(doc.completed),
    category: doc.category === 'food' ? 'food' : doc.category === 'daily' ? 'daily' : 'long_term',
    createdAt: asISO(doc.createdAt),
    createdBy: String(doc.createdBy || ''),
  }
}

/** 供单测使用。 */
export function toAnniversary(doc: Record<string, unknown>): AnniversaryEntry {
  return {
    id: String(doc._id || ''),
    title: String(doc.title || ''),
    date: String(doc.date || ''),
    repeatsYearly: Boolean(doc.repeatsYearly),
    kind: (doc.kind as AnniversaryEntry['kind']) || 'custom',
    note: String(doc.note || ''),
    createdAt: asISO(doc.createdAt),
    createdBy: String(doc.createdBy || ''),
  }
}

function toMessageNotes(doc: Record<string, unknown>): MessageNotes {
  return { likes: String(doc.likes || ''), dislikes: String(doc.dislikes || '') }
}

/** 供单测使用。 */
export function toReply(item: Record<string, unknown>): MessageReply {
  return {
    id: String(item.id || ''),
    createdBy: String(item.createdBy || ''),
    text: String(item.text || ''),
    createdAt: asISO(item.createdAt),
  }
}

/** 供单测使用。 */
export function toMessage(doc: Record<string, unknown>): MessageItem {
  const revealAt = doc.revealAt
  return {
    id: String(doc._id || doc.id || ''),
    text: String(doc.text || ''),
    revealAt: revealAt ? asISO(revealAt) : null,
    createdAt: asISO(doc.createdAt),
    createdBy: String(doc.createdBy || ''),
    replies: Array.isArray(doc.replies)
      ? doc.replies.map((reply) => toReply(reply as Record<string, unknown>))
      : [],
  }
}

/** 客户端防御性过滤：非法 revealAt 对接收方 fail closed；真正边界仍在 messageAccess。 */
export function filterVisibleMessages(messages: MessageItem[], myUserId: string, now = Date.now()): MessageItem[] {
  return messages.filter((message) => {
    if (message.createdBy === myUserId || !message.revealAt) return true
    const revealTimestamp = new Date(message.revealAt).getTime()
    return Number.isFinite(revealTimestamp) && revealTimestamp <= now
  })
}

async function fetchAll(collection: string, coupleId: string): Promise<Array<Record<string, unknown>>> {
  const db = cloudbaseDb()
  const result: Array<Record<string, unknown>> = []
  let skip = 0
  for (;;) {
    const response = await db.collection(collection).where({ coupleId }).skip(skip).limit(PAGE_SIZE).get()
    const docs = (response.data as Array<Record<string, unknown>>) || []
    result.push(...docs)
    if (docs.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  return result
}

async function loadCloudMessageNotes(coupleId: string): Promise<MessageNotes | null> {
  try {
    const result = await cloudbaseDb().collection('couple_notes').where({ coupleId }).limit(1).get()
    const doc = docData(result)
    return Object.keys(doc).length ? toMessageNotes(doc) : null
  } catch (error) {
    console.warn('CloudBase message notes unavailable', error)
    return null
  }
}

function toPartnerNote(doc: Record<string, unknown>): PartnerNote {
  if (typeof doc.id !== 'string' || !doc.id || typeof doc.text !== 'string'
    || (doc.kind !== 'like' && doc.kind !== 'care')
    || (doc.createdAt !== null && (typeof doc.createdAt !== 'string' || !Number.isFinite(Date.parse(doc.createdAt))))) {
    throw new Error('备忘服务返回异常，请稍后重试')
  }
  return {
    id: doc.id, text: doc.text, kind: doc.kind, createdAt: doc.createdAt,
    ...(typeof doc.createdBy === 'string' ? { createdBy: doc.createdBy } : {}),
    ...(doc.legacy === true ? { legacy: true } : {}),
    ...(doc.pinned === true ? { pinned: true } : {}),
  }
}

export async function loadCloudPartnerNotes(coupleId: string): Promise<PartnerNote[]> {
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', { action: 'listPartnerNotes', coupleId })
  if (!response.ok) throw new Error(response.message || '备忘读取失败')
  if (!Array.isArray(response.partnerNotes)) throw new Error('备忘服务返回异常，请稍后重试')
  return response.partnerNotes.map(toPartnerNote)
}

const TEMP_URL_CACHE_MS = 8 * 60 * 1000
const tempUrlCache = new Map<string, { url: string; expiresAt: number }>()

async function resolveTempUrls(assets: PhotoAsset[]): Promise<PhotoAsset[]> {
  const fileIDs = assets.map((photo) => photo.src).filter((src) => src && !src.startsWith('blob:') && !src.startsWith('data:'))
  const now = Date.now()
  const missing = [...new Set(fileIDs)].filter((fileID) => {
    const cached = tempUrlCache.get(fileID)
    return !cached || cached.expiresAt <= now
  })
  if (missing.length) {
    try {
      const urls = await tempUrlsFor(missing)
      const expiresAt = Date.now() + TEMP_URL_CACHE_MS
      for (const [fileID, url] of urls) tempUrlCache.set(fileID, { url, expiresAt })
    } catch (error) {
      console.warn('照片临时链接获取失败，稍后重试', error)
    }
  }
  return assets.map((photo) => ({
    ...photo,
    src: photo.src && !photo.src.startsWith('blob:') && !photo.src.startsWith('data:')
      ? tempUrlCache.get(photo.src)?.url || photo.src
      : photo.src,
  }))
}

async function loadCloudMemories(coupleId: string) {
  const docs = await fetchAll('memories', coupleId)
  const memories = docs.map(toMemory)
  const withUrls = await Promise.all(memories.map(async (memory) => ({
    ...memory,
    photos: await resolveTempUrls(memory.photos),
  })))
  return withUrls.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

export async function loadCloudMessages(coupleId: string) {
  const response = await callCloudFunction<MessageAccessResponse>('messageAccess', {
    action: 'list',
    coupleId,
  })
  if (!response.ok) throw new Error(response.message || '留言读取失败')
  // 云函数已按服务器时间剪裁，接收方的未揭晓原文不会进入浏览器。
  return (response.messages || []).map(toMessage)
}

const IDENTITY_SYNC_RETRIES = 2
const IDENTITY_SYNC_DELAY_MS = 350

function waitForIdentitySync() {
  return new Promise((resolve) => window.setTimeout(resolve, IDENTITY_SYNC_DELAY_MS))
}

async function getWorkspaceLookup(): Promise<WorkspaceLookupResponse> {
  let lookup: WorkspaceLookupResponse
  try {
    lookup = await callCloudFunction<WorkspaceLookupResponse>('getMyWorkspace')
  } catch (error) {
    throw new Error(messageFromUnknown(error, '情侣空间查询失败'))
  }
  if (!lookup.ok) throw new Error(lookup.message || '情侣空间查询失败')
  return lookup
}

async function getSynchronizedWorkspaceLookup(userId: string): Promise<WorkspaceLookupResponse> {
  let lookup = await getWorkspaceLookup()
  if (!lookup.couple) return lookup

  for (let attempt = 0; attempt <= IDENTITY_SYNC_RETRIES; attempt += 1) {
    const authenticatedUserId = String(lookup.me?.userId || '')
    if (authenticatedUserId && authenticatedUserId === userId) return lookup
    if (attempt === IDENTITY_SYNC_RETRIES) break

    try {
      await cloudbaseAuth().refreshTokenForce({})
    } catch (error) {
      console.warn('Could not refresh CloudBase credentials during identity sync', error)
    }
    await waitForIdentitySync()
    lookup = await getWorkspaceLookup()
    if (!lookup.couple) return lookup
  }

  throw new Error('登录状态正在同步，请稍后重试')
}

export async function loadCloudWorkspace(userId: string): Promise<CloudWorkspace | null> {
  const db = cloudbaseDb()
  // 工作区归属必须由服务端按当前登录身份判定。旧规则曾允许伪造自己的成员映射，
  // 客户端 limit(1) 既可能选中脏记录，也不能完成 couple/member 双向校验。
  const lookup = await getSynchronizedWorkspaceLookup(userId)
  if (!lookup.couple) return null

  const authenticatedUserId = String(lookup.me?.userId || '')
  if (!authenticatedUserId || authenticatedUserId !== userId) {
    throw new Error('登录状态正在同步，请稍后重试')
  }
  const coupleId = String(lookup.couple.coupleId || '')
  if (!coupleId) throw new Error('空间数据不存在，请重新创建')
  let coupleResult: { data?: unknown }
  let membersResult: { data?: unknown }
  let memories: MemoryEntry[]
  let wishes: Array<Record<string, unknown>>
  let anniversaries: Array<Record<string, unknown>>
  let messages: MessageItem[]
  let messageNotes: MessageNotes | null
  let partnerNotes: PartnerNote[]
  try {
    ;[coupleResult, membersResult, memories, wishes, anniversaries, messages, messageNotes, partnerNotes] = await Promise.all([
      db.collection('couples').doc(coupleId).get(),
      db.collection('couple_members').where({ coupleId }).get(),
      loadCloudMemories(coupleId),
      fetchAll('wishes', coupleId),
      fetchAll('anniversaries', coupleId),
      loadCloudMessages(coupleId),
      loadCloudMessageNotes(coupleId),
      loadCloudPartnerNotes(coupleId),
    ])
  } catch (error) {
    throw new Error(`云端数据读取失败：${messageFromUnknown(error, '未知错误')}`)
  }

  const couple = docData(coupleResult)
  if (!couple || !Array.isArray(couple.memberIds)) {
    throw new Error(`空间数据不存在，请重新创建（coupleId=${coupleId}，返回=${JSON.stringify(coupleResult).slice(0, 300)}）`)
  }
  const coupleMemberIds = couple.memberIds.map(String)
  if (!coupleMemberIds.includes(authenticatedUserId)) {
    throw new Error('你不是这个情侣空间的成员')
  }
  // 只接受与 couples.memberIds 对得上、且使用规范文档 id 的成员资料。
  const members = ((membersResult.data as Array<Record<string, unknown>>) || []).filter((member) => {
    const memberUserId = String(member.userId || '')
    return coupleMemberIds.includes(memberUserId)
      && String(member.coupleId || '') === coupleId
      && String(member._id || '') === `${coupleId}_${memberUserId}`
  })
  const ordered = [...members].sort((a, b) => asISO(a.joinedAt).localeCompare(asISO(b.joinedAt)))
  // 绑定用户（邮箱↔微信）会在 memberIds 里同时拥有 openid 别名与 customUserId，
  // 服务端 getMyWorkspace 已按绑定关系去重，这里优先用服务端结果，避免把同一个人当成两个人。
  const serverMemberIds = Array.isArray(lookup.couple?.memberIds)
    ? lookup.couple.memberIds.map(String)
    : []
  const memberIds = serverMemberIds.length > 0 ? serverMemberIds : coupleMemberIds
  const nameFor = (id?: string) => {
    if (!id) return 'TA'
    const member = ordered.find((item) => String(item.userId) === id)
    return String(member?.displayName || 'TA')
  }

  return {
    coupleId,
    inviteCode: String(couple.inviteCode || ''),
    memberIds,
    profile: {
      personA: nameFor(memberIds[0]),
      personB: nameFor(memberIds[1]),
      startDate: String(couple.startDate || ''),
      nextMilestoneTitle: String(couple.nextMilestoneTitle || '下一次纪念日'),
      nextMilestoneDate: String(couple.nextMilestoneDate || ''),
    },
    memories,
    wishes: wishes.map(toWish),
    anniversaries: anniversaries.map(toAnniversary),
    messages,
    messageNotes,
    partnerNotes,
  }
}

function dataUrlToBlob(source: string) {
  return fetch(source).then((response) => {
    if (!response.ok) throw new Error('照片读取失败')
    return response.blob()
  })
}

async function blobForAsset(photo: PhotoAsset) {
  if (photo.blob) return photo.blob
  return dataUrlToBlob(photo.src)
}

export function extensionForMime(mimeType: string, name: string) {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/heic') return 'heic'
  if (normalized === 'image/heif') return 'heif'
  if (normalized === 'video/quicktime') return 'mov'
  if (normalized === 'video/webm') return 'webm'
  if (normalized === 'video/x-m4v') return 'm4v'
  if (normalized === 'video/mp4') return 'mp4'
  const fromName = name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'mov', 'webm', 'm4v', 'mp4'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName
  }
  return normalized.startsWith('video/') ? 'mp4' : 'jpg'
}

export function contentTypeForAsset(photo: PhotoAsset, blob: Blob) {
  const detected = blob.type.toLowerCase()
  const expected = photo.mimeType.toLowerCase()
  if (!detected || detected === 'application/octet-stream') return expected
  if (photo.kind === 'video' && !detected.startsWith('video/')) return expected
  if (photo.kind === 'image' && !detected.startsWith('image/')) return expected
  return detected
}

function photoDoc(photo: PhotoAsset, fileID: string): PhotoDoc {
  return {
    id: photo.id,
    src: fileID,
    fileID,
    storagePath: fileID,
    name: photo.name,
    alt: photo.alt,
    caption: photo.caption,
    order: photo.order,
    role: photo.role,
    focusX: photo.focusX,
    focusY: photo.focusY,
    kind: photo.kind,
    mimeType: photo.mimeType,
  }
}

function fileIDOf(photo: Record<string, unknown>): string {
  return String(photo.fileID || photo.src || photo.storagePath || '')
}

function memoryDoc(coupleId: string, memory: MemoryEntry, photos: PhotoDoc[]) {
  return {
    coupleId,
    authorId: currentUserId(),
    title: memory.title,
    originalText: memory.originalText,
    displayText: memory.displayText,
    date: memory.date,
    location: memory.location,
    latitude: memory.latitude,
    longitude: memory.longitude,
    style: memory.style,
    template: memory.template,
    tags: memory.tags,
    category: memory.category,
    moodEmoji: memory.moodEmoji,
    moodText: memory.moodText,
    isDemo: memory.isDemo || false,
    isLiked: memory.isLiked || false,
    themeColor: memory.themeColor || '',
    photos,
    createdAt: memory.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export async function putCloudMemory(coupleId: string, memory: MemoryEntry) {
  const uploadedFileIDs: string[] = []
  try {
    const photos: PhotoDoc[] = []
    for (const photo of memory.photos) {
      const blob = await blobForAsset(photo)
      const contentType = contentTypeForAsset(photo, blob)
      const extension = extensionForMime(contentType, photo.name)
      const fileID = await uploadCloudFile(memory.id, photo.id, extension, blob)
      uploadedFileIDs.push(fileID)
      photos.push(photoDoc(photo, fileID))
    }
    const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
      action: 'putMemory',
      coupleId,
      memoryId: memory.id,
      doc: memoryDoc(coupleId, memory, photos),
    })
    if (!response.ok) throw new Error(response.message || '回忆保存失败')
  } catch (error) {
    await deleteCloudFiles(uploadedFileIDs)
    throw new Error(messageFromUnknown(error, '回忆保存失败'))
  }
}

export async function updateCloudMemory(coupleId: string, memory: MemoryEntry) {
  const db = cloudbaseDb()
  const uploadedFileIDs: string[] = []
  let removedFileIDs: string[] = []
  try {
    // 安全规则引擎对单文档 doc().get() 不执行跨集合 get() 校验（返回 Permission denied），
    // where({_id}) 查询则能正常通过，所以单文档读取统一走 where + limit(1)。
    const existingResult = await db.collection('memories').where({ _id: memory.id, coupleId }).limit(1).get()
    const existingDoc = docData(existingResult)
    const existingPhotos = (Array.isArray(existingDoc.photos) ? existingDoc.photos : []) as Array<Record<string, unknown>>
    const existingById = new Map(existingPhotos.map((photo) => [String(photo.id || ''), photo]))
    const nextIds = new Set(memory.photos.map((photo) => photo.id))
    removedFileIDs = existingPhotos
      .filter((photo) => !nextIds.has(String(photo.id || '')))
      .map(fileIDOf)
      .filter(Boolean)

    const photos: PhotoDoc[] = []
    for (const photo of memory.photos) {
      const existing = existingById.get(photo.id)
      const existingFileID = existing ? fileIDOf(existing) : ''
      if (existingFileID) {
        photos.push(photoDoc(photo, existingFileID))
        continue
      }
      const blob = await blobForAsset(photo)
      const contentType = contentTypeForAsset(photo, blob)
      const extension = extensionForMime(contentType, photo.name)
      const fileID = await uploadCloudFile(memory.id, photo.id, extension, blob)
      uploadedFileIDs.push(fileID)
      photos.push(photoDoc(photo, fileID))
    }
    const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
      action: 'putMemory',
      coupleId,
      memoryId: memory.id,
      doc: memoryDoc(coupleId, memory, photos),
    })
    if (!response.ok) throw new Error(response.message || '回忆更新失败')
  } catch (error) {
    await deleteCloudFiles(uploadedFileIDs)
    throw new Error(messageFromUnknown(error, '回忆更新失败'))
  }
  await deleteCloudFiles(removedFileIDs)
}

export async function removeCloudMemory(coupleId: string, memory: MemoryEntry) {
  try {
    // 删除 = 移入回收站（30 天可恢复），照片文件随条目保留，由 trashAccess 彻底清理时才删除
    const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
      action: 'removeMemory',
      coupleId,
      memoryId: memory.id,
    })
    if (!response.ok) throw new Error(response.message || '回忆删除失败')
  } catch (error) {
    throw new Error(messageFromUnknown(error, '回忆删除失败'))
  }
}

export async function saveCloudProfile(
  coupleId: string,
  currentUserId: string,
  profile: CoupleProfile,
  memberIds: string[],
) {
  const ownName = memberIds[0] === currentUserId ? profile.personA : profile.personB
  const response = await callCloudFunction<{ ok: boolean; message?: string }>('updateMyProfile', {
    coupleId,
    displayName: ownName.trim(),
    startDate: profile.startDate,
  })
  if (!response.ok) throw new Error(response.message || '资料保存失败')

  // 登录页和首次建空间会使用这份本地元数据作为昵称回退值。
  const meta = readSessionMeta()
  writeSessionMeta({ ...meta, displayName: ownName.trim() })
}

export async function createCloudAnniversary(
  coupleId: string,
  userId: string,
  anniversary: AnniversaryEntry,
) {
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'createAnniversary',
    coupleId,
    anniversaryId: anniversary.id,
    doc: {
      createdBy: userId,
      title: anniversary.title.trim(),
      date: anniversary.date,
      repeatsYearly: anniversary.repeatsYearly,
      kind: anniversary.kind,
      note: anniversary.note.trim(),
      createdAt: anniversary.createdAt || new Date().toISOString(),
    },
  })
  if (!response.ok) throw new Error(response.message || '纪念日保存失败')
}

export async function updateCloudAnniversary(
  coupleId: string,
  anniversary: AnniversaryEntry,
) {
  const db = cloudbaseDb()
  const existing = await db.collection('anniversaries').where({ _id: anniversary.id, coupleId }).limit(1).get()
  const existingDoc = docData(existing)
  if (!existingDoc || Object.keys(existingDoc).length === 0) {
    throw new Error('没有找到这个纪念日，可能已经被对方删除')
  }
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'updateAnniversary',
    coupleId,
    anniversaryId: anniversary.id,
    patch: {
      title: anniversary.title.trim(),
      date: anniversary.date,
      repeatsYearly: anniversary.repeatsYearly,
      kind: anniversary.kind,
      note: anniversary.note.trim(),
    },
  })
  if (!response.ok) throw new Error(response.message || '纪念日保存失败')
}

export async function removeCloudAnniversary(coupleId: string, anniversaryId: string) {
  const db = cloudbaseDb()
  const existing = await db.collection('anniversaries').where({ _id: anniversaryId, coupleId }).limit(1).get()
  const existingDoc = docData(existing)
  if (!existingDoc || Object.keys(existingDoc).length === 0) {
    throw new Error('没有找到这个纪念日，页面已经为你刷新')
  }
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'removeAnniversary',
    coupleId,
    anniversaryId,
  })
  if (!response.ok) throw new Error(response.message || '纪念日删除失败')
}

interface TrashAccessResponse {
  ok: boolean
  items?: CloudTrashItem[]
  code?: string
  message?: string
}

export async function listCloudTrash(coupleId: string): Promise<CloudTrashItem[]> {
  const response = await callCloudFunction<TrashAccessResponse>('trashAccess', {
    action: 'list',
    coupleId,
  })
  if (!response.ok) throw new Error(response.message || '回收站读取失败')
  return response.items || []
}

export async function restoreCloudTrash(coupleId: string, trashId: string) {
  const response = await callCloudFunction<TrashAccessResponse>('trashAccess', {
    action: 'restore',
    coupleId,
    trashId,
  })
  if (!response.ok) throw new Error(response.message || '恢复失败')
}

export async function purgeCloudTrash(coupleId: string, trashId: string) {
  const response = await callCloudFunction<TrashAccessResponse>('trashAccess', {
    action: 'purge',
    coupleId,
    trashId,
  })
  if (!response.ok) throw new Error(response.message || '彻底删除失败')
}

export async function createCloudMessage(coupleId: string, _userId: string, message: MessageItem) {
  const response = await callCloudFunction<MessageAccessResponse>('messageAccess', {
    action: 'create',
    coupleId,
    messageId: message.id,
    text: message.text.trim(),
    revealAt: message.revealAt,
  })
  if (!response.ok) throw new Error(response.message || '留言保存失败')
}

export async function addCloudMessageReply(
  coupleId: string,
  _userId: string,
  messageId: string,
  reply: MessageReply,
) {
  const response = await callCloudFunction<MessageAccessResponse>('messageAccess', {
    action: 'reply',
    coupleId,
    messageId,
    replyId: reply.id,
    text: reply.text.trim(),
  })
  if (!response.ok) throw new Error(response.message || '回复发送失败')
}

export async function removeCloudMessage(coupleId: string, messageId: string) {
  const response = await callCloudFunction<MessageAccessResponse>('messageAccess', {
    action: 'delete',
    coupleId,
    messageId,
  })
  if (!response.ok) throw new Error(response.message || '留言删除失败')
}

export async function syncCloudWishes(
  coupleId: string,
  userId: string,
  previous: WishItem[],
  next: WishItem[],
) {
  const previousById = new Map(previous.map((wish) => [wish.id, wish]))
  const nextIds = new Set(next.map((wish) => wish.id))
  const removed = previous.filter((wish) => !nextIds.has(wish.id)).map((wish) => wish.id)
  const created = next.filter((wish) => !previousById.has(wish.id))
  const updated = next.filter((wish) => {
    const old = previousById.get(wish.id)
    return Boolean(old && (old.text !== wish.text || old.completed !== wish.completed || old.category !== wish.category))
  })

  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'syncWishes',
    coupleId,
    created: created.map((wish) => ({
      id: wish.id,
      doc: {
        createdBy: wish.createdBy || userId,
        text: wish.text,
        completed: wish.completed,
        category: wish.category,
        completedAt: wish.completed ? new Date().toISOString() : null,
        createdAt: wish.createdAt || new Date().toISOString(),
      },
    })),
    updated: updated.map((wish) => ({
      id: wish.id,
      patch: {
        text: wish.text,
        completed: wish.completed,
        category: wish.category,
        completedAt: wish.completed ? new Date().toISOString() : null,
      },
    })),
    removed,
  })
  if (!response.ok) throw new Error(response.message || '愿望保存失败')
}

// 旧 CloudBase 部署没有喜好备忘集合时，前端继续使用本机按情侣空间隔离的降级存储。
export async function saveCloudMessageNotes(coupleId: string, notes: MessageNotes) {
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'saveMessageNotes',
    coupleId,
    notes: { likes: notes.likes.trim(), dislikes: notes.dislikes.trim() },
  })
  if (!response.ok) throw new Error(response.message || '喜欢备忘保存失败')
}

async function savePartnerNote(action: 'createPartnerNote' | 'updatePartnerNote', coupleId: string, input: PartnerNoteInput, noteId?: string): Promise<PartnerNote> {
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action, coupleId, ...(noteId ? { noteId } : {}),
    note: { text: input.text.trim(), kind: input.kind },
  })
  if (!response.ok) throw new Error(response.message || '备忘保存失败')
  if (!response.partnerNote) throw new Error('备忘服务返回异常，请稍后重试')
  return toPartnerNote(response.partnerNote)
}

export function createCloudPartnerNote(coupleId: string, input: PartnerNoteInput): Promise<PartnerNote> {
  return savePartnerNote('createPartnerNote', coupleId, input)
}

export function updateCloudPartnerNote(coupleId: string, id: string, input: PartnerNoteInput): Promise<PartnerNote> {
  return savePartnerNote('updatePartnerNote', coupleId, input, id)
}

export async function setCloudPartnerNotePinned(coupleId: string, id: string, pinned: boolean): Promise<PartnerNote> {
  if (typeof pinned !== 'boolean') throw new Error('置顶状态格式不正确')
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', {
    action: 'setPartnerNotePinned', coupleId, noteId: id, pinned,
  })
  if (!response.ok) throw new Error(response.message || '备忘置顶失败')
  if (!response.partnerNote) throw new Error('备忘服务返回异常，请稍后重试')
  return toPartnerNote(response.partnerNote)
}

export async function deleteCloudPartnerNote(coupleId: string, id: string): Promise<void> {
  const response = await callCloudFunction<DataAccessResponse>('dataAccess', { action: 'deletePartnerNote', coupleId, noteId: id })
  if (!response.ok) throw new Error(response.message || '备忘删除失败')
}

// messages 原文对客户端全拒绝；messageAccess 会触摸 couples.messageUpdatedAt 以触发此处刷新。
const WATCH_COLLECTIONS = ['couples', 'couple_members', 'memories', 'wishes', 'anniversaries', 'couple_notes', 'partner_notes'] as const

export function subscribeToCloudWorkspace(coupleId: string, onChange: () => void): CloudWatchHandle {
  const db = cloudbaseDb()
  const watchers: Array<{ close(): void }> = []
  let fallbackTimer = 0
  let closed = false

  const startFallback = () => {
    if (closed || fallbackTimer) return
    console.warn('CloudBase watch 不可用，降级为 30s 轮询同步')
    fallbackTimer = window.setInterval(() => { if (!closed) onChange() }, 30_000)
  }

  for (const name of WATCH_COLLECTIONS) {
    try {
      const query = name === 'couples'
        ? db.collection(name).doc(coupleId)
        : db.collection(name).where({ coupleId })
      const watcher = query.watch({
        onChange: () => { if (!closed) onChange() },
        onError: (error: unknown) => {
          if (closed) return
          console.warn(`watch(${name}) 出错`, error)
          startFallback()
        },
      })
      watchers.push(watcher)
    } catch (error) {
      console.warn(`watch(${name}) 启动失败`, error)
      startFallback()
    }
  }

  return {
    close: () => {
      if (closed) return
      closed = true
      for (const watcher of watchers) watcher.close()
      if (fallbackTimer) window.clearInterval(fallbackTimer)
      fallbackTimer = 0
    },
  }
}

export function unsubscribeCloudWorkspace(handle: CloudWatchHandle) {
  void handle.close()
}
