import type { RealtimeChannel } from '@supabase/supabase-js'
import type {
  AnniversaryEntry,
  AnniversaryKind,
  CloudWorkspace,
  CoupleProfile,
  LayoutStyle,
  LayoutTemplate,
  MediaKind,
  MemoryCategory,
  MemoryEntry,
  MessageItem,
  MessageReply,
  MessageNotes,
  PartnerNote,
  PartnerNoteInput,
  PhotoAsset,
  WishCategory,
  WishItem,
} from '../../types'
import type { CloudSession, CloudUser, CloudWatchHandle, CloudTrashItem } from '../providers'
import { inferMediaKind, normalizeMemory } from '../../features/memories/memory'
import { requireSupabase } from '../supabase'
import { validatePartnerNoteInput } from '../partner-notes-data'

const PHOTO_BUCKET = 'couple-photos'
const SIGNED_URL_SECONDS = 60 * 60 * 12
let workspaceChannelSequence = 0

interface CoupleRow {
  id: string
  invite_code: string | null
  start_date: string
  next_milestone_title: string | null
  next_milestone_date: string | null
}

interface MemberRow {
  user_id: string
  joined_at: string
}

interface ProfileRow {
  id: string
  display_name: string
}

interface PhotoRow {
  id: string
  storage_path: string
  name: string
  alt: string
  caption: string
  sort_order: number
  role: 'cover' | 'supporting'
  focus_x: number
  focus_y: number
  media_kind: MediaKind
  mime_type: string
}

interface MemoryRow {
  id: string
  title: string
  original_text: string
  display_text: string
  memory_date: string
  location: string
  latitude: number | null
  longitude: number | null
  style: LayoutStyle
  template: LayoutTemplate
  tags: string[] | null
  category: MemoryCategory
  mood_emoji: string
  mood_text: string
  is_liked: boolean
  theme_color?: string | null
  created_at: string
  memory_photos: PhotoRow[] | null
}

interface WishRow {
  id: string
  text: string
  completed: boolean
  category: WishCategory
  created_at: string
  created_by: string
}

interface AnniversaryRow {
  id: string
  title: string
  event_date: string
  repeats_yearly: boolean
  kind: AnniversaryKind
  note: string
  created_at: string
  created_by: string
}

interface MessageRow {
  id: string
  text: string
  reveal_at: string | null
  created_at: string
  created_by: string
  replies?: MessageReply[] | null
}

function messageFromError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message)
    if (message.includes('Invalid login credentials')) return '邮箱或密码不正确'
    if (message.includes('Email not confirmed')) return '请先打开验证邮件完成邮箱确认'
    if (message.includes('User already registered')) return '这个邮箱已经注册，可以直接登录'
    return message
  }
  return fallback
}

export async function signInWithEmail(email: string, password: string): Promise<CloudSession | null> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password })
  if (error) throw new Error(messageFromError(error, '登录失败'))
  return data.session
}

export async function signUpWithEmail(
  displayName: string,
  email: string,
  password: string,
): Promise<{ user: CloudUser | null; session: CloudSession | null }> {
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: `${window.location.origin}/`,
    },
  })
  if (error) throw new Error(messageFromError(error, '注册失败'))
  return data
}

/** supabase 后端无需清理 SDK 会话存储（保留同签名以对齐 cloudbase provider）。 */
export function clearSdkSessionStorage() {
  // no-op
}

export async function signOutCloud() {
  const { error } = await requireSupabase().auth.signOut()
  if (error) throw error
}

export async function getCloudSession(): Promise<CloudSession | null> {
  const { data, error } = await requireSupabase().auth.getSession()
  if (error) throw error
  return data.session ?? null
}

export function onCloudAuthChange(callback: (session: CloudSession | null) => void): () => void {
  const { data } = requireSupabase().auth.onAuthStateChange((_event, nextSession) => {
    callback(nextSession ?? null)
  })
  return () => data.subscription.unsubscribe()
}

export async function createCloudCouple(displayName: string, startDate: string) {
  const { error } = await requireSupabase().rpc('create_couple', {
    p_display_name: displayName.trim(),
    p_start_date: startDate,
  })
  if (error) throw new Error(messageFromError(error, '情侣空间创建失败'))
}

export async function joinCloudCouple(displayName: string, inviteCode: string) {
  const { error } = await requireSupabase().rpc('join_couple', {
    p_display_name: displayName.trim(),
    p_invite_code: inviteCode.trim().toUpperCase(),
  })
  if (error) {
    const raw = messageFromError(error, '加入失败')
    if (/invite|code|邀请码/i.test(raw)) throw new Error('邀请码无效或已经过期')
    if (/full|two|member|人数/i.test(raw)) throw new Error('这个情侣空间已经有两位成员')
    throw new Error(raw)
  }
}

async function signedPhotoAssets(rows: PhotoRow[]) {
  if (!rows.length) return []
  const client = requireSupabase()
  const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order)
  const paths = ordered.map((photo) => photo.storage_path)
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  if (error) throw error

  return ordered.map<PhotoAsset>((photo, index) => ({
    id: photo.id,
    src: data[index]?.signedUrl || '',
    name: photo.name,
    alt: photo.alt,
    caption: photo.caption,
    order: photo.sort_order,
    role: photo.role,
    focusX: Number(photo.focus_x),
    focusY: Number(photo.focus_y),
    kind: photo.media_kind || inferMediaKind(photo.mime_type, photo.name),
    mimeType: photo.mime_type || 'application/octet-stream',
    storagePath: photo.storage_path,
  }))
}

async function loadCloudMemories(coupleId: string) {
  let result: {
    data: MemoryRow[] | null
    error: { code?: string; message: string } | null
  } = await requireSupabase()
    .from('memories')
    .select('id,title,original_text,display_text,memory_date,location,latitude,longitude,style,template,tags,category,mood_emoji,mood_text,is_liked,theme_color,created_at,memory_photos(id,storage_path,name,alt,caption,sort_order,role,focus_x,focus_y,media_kind,mime_type)')
    .eq('couple_id', coupleId)
    .order('memory_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (result.error && result.error.code === '42703') {
    // 旧数据库还没有 theme_color 列（迁移未执行），退回不带颜色的读取
    console.warn('memories 表尚无 theme_color 列，按无色降级读取', result.error)
    result = await requireSupabase()
      .from('memories')
      .select('id,title,original_text,display_text,memory_date,location,latitude,longitude,style,template,tags,category,mood_emoji,mood_text,is_liked,created_at,memory_photos(id,storage_path,name,alt,caption,sort_order,role,focus_x,focus_y,media_kind,mime_type)')
      .eq('couple_id', coupleId)
      .order('memory_date', { ascending: false })
      .order('created_at', { ascending: false })
  }
  if (result.error) throw result.error

  return Promise.all((result.data as MemoryRow[]).map(async (row) => normalizeMemory({
    id: row.id,
    title: row.title,
    originalText: row.original_text,
    displayText: row.display_text,
    date: row.memory_date,
    location: row.location || '',
    latitude: row.latitude === null ? undefined : Number(row.latitude),
    longitude: row.longitude === null ? undefined : Number(row.longitude),
    style: row.style,
    template: row.template,
    photos: await signedPhotoAssets(row.memory_photos || []),
    tags: row.tags || [],
    category: row.category,
    moodEmoji: row.mood_emoji || '',
    moodText: row.mood_text || '',
    isLiked: row.is_liked || false,
    themeColor: row.theme_color || undefined,
    createdAt: row.created_at,
  } satisfies MemoryEntry)))
}

async function loadCloudWishes(coupleId: string) {
  try {
    const { data, error } = await requireSupabase()
      .from('wishes')
      .select('id,text,completed,category,created_at,created_by')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data as WishRow[]).map<WishItem>((wish) => ({
      id: wish.id,
      text: wish.text,
      completed: wish.completed,
      category: wish.category,
      createdAt: wish.created_at,
      createdBy: wish.created_by,
    }))
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '42P01' || code === '42703') {
      console.warn('wishes 表尚缺 category 字段（旧数据库），按空列表降级', error)
      return []
    }
    throw error
  }
}

async function loadCloudAnniversaries(coupleId: string) {
  const { data, error } = await requireSupabase()
    .from('anniversaries')
    .select('id,title,event_date,repeats_yearly,kind,note,created_at,created_by')
    .eq('couple_id', coupleId)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as AnniversaryRow[]).map<AnniversaryEntry>((entry) => ({
    id: entry.id,
    title: entry.title,
    date: entry.event_date,
    repeatsYearly: entry.repeats_yearly,
    kind: entry.kind,
    note: entry.note,
    createdAt: entry.created_at,
    createdBy: entry.created_by,
  }))
}

/**
 * 留言加载：任何错误都按空列表降级（console.warn），
 * 避免旧数据库缺表时拖垮整个 loadCloudWorkspace 的 Promise.all。
 * 未揭开留言的可见性由 RLS 保证，客户端不再二次过滤。
 */
export async function loadCloudMessages(coupleId: string) {
  try {
    let result: {
      data: MessageRow[] | null
      error: { code?: string; message: string } | null
    } = await requireSupabase()
      .from('messages')
      .select('id,text,reveal_at,created_at,created_by,replies')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: false })
    if (result.error && result.error.code === '42703') {
      // 旧数据库还没有 replies 列（迁移未执行），退回不带回复的读取
      console.warn('messages 表尚无 replies 列，按无回复降级读取', result.error)
      result = await requireSupabase()
        .from('messages')
        .select('id,text,reveal_at,created_at,created_by')
        .eq('couple_id', coupleId)
        .order('created_at', { ascending: false })
    }
    if (result.error) throw result.error
    return (result.data as MessageRow[]).map<MessageItem>((message) => ({
      id: message.id,
      text: message.text,
      revealAt: message.reveal_at,
      createdAt: message.created_at,
      createdBy: message.created_by,
      replies: message.replies || [],
    }))
  } catch (error) {
    console.warn('留言读取失败（若为旧数据库则属预期），按空列表降级', error)
    return []
  }
}

async function loadCloudMessageNotes(coupleId: string): Promise<MessageNotes | null> {
  const { data, error } = await requireSupabase()
    .from('couple_notes')
    .select('likes,dislikes')
    .eq('couple_id', coupleId)
    .maybeSingle()
  if (error) {
    if (error.code === '42P01' || error.code === '42703') return null
    throw error
  }
  return { likes: String(data?.likes || ''), dislikes: String(data?.dislikes || '') }
}

function toPartnerNote(row: Record<string, unknown>): PartnerNote {
  return {
    id: String(row.id), text: String(row.text), kind: row.kind === 'care' ? 'care' : 'like',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    createdBy: typeof row.created_by === 'string' ? row.created_by : undefined,
    legacy: row.legacy === true,
    ...(row.pinned === true ? { pinned: true } : {}),
  }
}

export async function loadCloudPartnerNotes(coupleId: string): Promise<PartnerNote[]> {
  const notes = new Map<string, PartnerNote>()
  const pageSize = 200
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from('partner_notes')
      .select('id,text,kind,created_at,created_by,legacy,pinned')
      .eq('couple_id', coupleId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(messageFromError(error, '备忘读取失败，请确认数据库已更新'))
    for (const row of data || []) { const note = toPartnerNote(row); notes.set(note.id, note) }
    if (!data || data.length < pageSize) return [...notes.values()]
  }
}

export async function createCloudPartnerNote(coupleId: string, input: PartnerNoteInput): Promise<PartnerNote> {
  const values = validatePartnerNoteInput(input)
  const { data, error } = await requireSupabase().from('partner_notes')
    .insert({ couple_id: coupleId, ...values })
    .select('id,text,kind,created_at,created_by,legacy,pinned').single()
  if (error) throw new Error(messageFromError(error, '备忘发布失败'))
  if (!data) throw new Error('备忘发布失败，请重试')
  return toPartnerNote(data)
}

export async function updateCloudPartnerNote(coupleId: string, id: string, input: PartnerNoteInput): Promise<PartnerNote> {
  const values = validatePartnerNoteInput(input)
  const { data, error } = await requireSupabase().from('partner_notes')
    .update(values).eq('couple_id', coupleId).eq('id', id)
    .select('id,text,kind,created_at,created_by,legacy,pinned').maybeSingle()
  if (error) throw new Error(messageFromError(error, '备忘修改失败'))
  if (!data) throw new Error('这条备忘已被删除或无法访问，请刷新后重试')
  return toPartnerNote(data)
}

export async function deleteCloudPartnerNote(coupleId: string, id: string): Promise<void> {
  const { data, error } = await requireSupabase().from('partner_notes')
    .delete().eq('couple_id', coupleId).eq('id', id).select('id').maybeSingle()
  if (error) throw new Error(messageFromError(error, '备忘删除失败'))
  if (!data) throw new Error('这条备忘已被删除或无法访问，请刷新后重试')
}

export async function setCloudPartnerNotePinned(coupleId: string, id: string, pinned: boolean): Promise<PartnerNote> {
  if (typeof pinned !== 'boolean') throw new Error('置顶状态格式不正确')
  const { data, error } = await requireSupabase().from('partner_notes')
    .update({ pinned }).eq('couple_id', coupleId).eq('id', id)
    .select('id,text,kind,created_at,created_by,legacy,pinned').maybeSingle()
  if (error) throw new Error(messageFromError(error, '备忘置顶失败'))
  if (!data) throw new Error('这条备忘已被删除或无法访问，请刷新后重试')
  return toPartnerNote(data)
}

function trashFailure(error: unknown, fallback: string) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  if (message.includes('NOT_A_MEMBER')) return new Error('你不在这个情侣空间里')
  if (message.includes('MESSAGE_LOCKED')) return new Error('这条留言还没有到揭晓时间')
  if (message.includes('TRASH_EXPIRED')) return new Error('这条记录已超过 30 天，无法恢复')
  if (message.includes('TRASH_PURGING')) return new Error('这条记录正在彻底删除，无法恢复；可以重试彻底删除')
  if (message.includes('RESTORE_CONFLICT')) return new Error('同编号的内容已经存在，已保留当前内容，请刷新后重试')
  return new Error(messageFromError(error, fallback))
}

export async function listCloudTrash(coupleId: string): Promise<CloudTrashItem[]> {
  const items: CloudTrashItem[] = []
  const pageSize = 200
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from('trash_entries')
      .select('id,kind,original_id,title,deleted_at,expires_at').eq('couple_id', coupleId)
      .order('deleted_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + pageSize - 1)
    if (error) throw trashFailure(error, '回收站读取失败，请确认数据库已更新')
    for (const row of data || []) {
      items.push({ id: row.id, kind: row.kind, originalId: row.original_id, title: row.title, deletedAt: row.deleted_at, expiresAt: row.expires_at })
    }
    if (!data || data.length < pageSize) break
  }
  // Collect all pages before cleanup, so deleting expired rows cannot shift offsets.
  const visible: CloudTrashItem[] = []
  for (const item of items) {
    if (Date.parse(item.expiresAt) <= Date.now()) {
      try { await purgeCloudTrash(coupleId, item.id) }
      catch (error) { console.warn('过期回收站清理未完成，将在下次读取时重试', error) }
    } else visible.push(item)
  }
  return visible
}

export async function restoreCloudTrash(coupleId: string, id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('restore_trash_entry', { p_couple_id: coupleId, p_id: id })
  if (error) throw trashFailure(error, '恢复失败')
}

export async function purgeCloudTrash(coupleId: string, id: string): Promise<void> {
  const client = requireSupabase()
  const { data, error } = await client.rpc('prepare_trash_purge', { p_couple_id: coupleId, p_id: id })
  if (error) throw trashFailure(error, '彻底删除失败')
  if (!Array.isArray(data) || !data.every((path) => typeof path === 'string' && path.startsWith(coupleId + '/'))) {
    throw new Error('回收站文件信息异常，已停止删除')
  }
  if (data.length) {
    const result = await client.storage.from(PHOTO_BUCKET).remove(data)
    if (result.error) throw new Error('原文件尚未删除，请重试彻底删除')
  }
  const result = await client.rpc('finish_trash_purge', { p_couple_id: coupleId, p_id: id })
  if (result.error) throw trashFailure(result.error, '文件已删除，回收站记录尚未清理，请重试')
}

export async function loadCloudWorkspace(userId: string): Promise<CloudWorkspace | null> {
  const client = requireSupabase()
  const { data: ownMembership, error: membershipError } = await client
    .from('couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!ownMembership) return null

  const coupleId = ownMembership.couple_id as string
  const [coupleResult, membersResult, memories, wishes, anniversaries, messages, messageNotes, partnerNotes] = await Promise.all([
    client.from('couples').select('id,invite_code,start_date,next_milestone_title,next_milestone_date').eq('id', coupleId).single(),
    client.from('couple_members').select('user_id,joined_at').eq('couple_id', coupleId).order('joined_at', { ascending: true }),
    loadCloudMemories(coupleId),
    loadCloudWishes(coupleId),
    loadCloudAnniversaries(coupleId),
    loadCloudMessages(coupleId),
    loadCloudMessageNotes(coupleId),
    loadCloudPartnerNotes(coupleId),
  ])
  if (coupleResult.error) throw coupleResult.error
  if (membersResult.error) throw membersResult.error

  const couple = coupleResult.data as CoupleRow
  const members = membersResult.data as MemberRow[]
  const memberIds = members.map((member) => member.user_id)
  const profilesResult = await client.from('profiles').select('id,display_name').in('id', memberIds)
  if (profilesResult.error) throw profilesResult.error
  const profiles = profilesResult.data as ProfileRow[]
  const nameFor = (id?: string) => profiles.find((profile) => profile.id === id)?.display_name || 'TA'

  return {
    coupleId,
    inviteCode: couple.invite_code || '',
    memberIds,
    profile: {
      personA: nameFor(memberIds[0]),
      personB: nameFor(memberIds[1]),
      startDate: couple.start_date,
      nextMilestoneTitle: couple.next_milestone_title || '下一次纪念日',
      nextMilestoneDate: couple.next_milestone_date || '',
    },
    memories,
    wishes,
    anniversaries,
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

const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024

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

function cloudMemoryValues(memory: MemoryEntry) {
  return {
    title: memory.title,
    original_text: memory.originalText,
    display_text: memory.displayText,
    memory_date: memory.date,
    location: memory.location,
    latitude: memory.latitude ?? null,
    longitude: memory.longitude ?? null,
    style: memory.style,
    template: memory.template,
    tags: memory.tags,
    category: memory.category,
    mood_emoji: memory.moodEmoji,
    mood_text: memory.moodText,
    is_demo: memory.isDemo || false,
    is_liked: memory.isLiked || false,
    theme_color: memory.themeColor || null,
  }
}

function cloudPhotoValues(photo: PhotoAsset) {
  return {
    name: photo.name,
    alt: photo.alt,
    caption: photo.caption,
    sort_order: photo.order,
    role: photo.role,
    focus_x: photo.focusX,
    focus_y: photo.focusY,
    media_kind: photo.kind,
    mime_type: photo.mimeType,
  }
}

export function contentTypeForAsset(photo: PhotoAsset, blob: Blob) {
  const detected = blob.type.toLowerCase()
  const expected = photo.mimeType.toLowerCase()
  if (!detected || detected === 'application/octet-stream') return expected
  if (photo.kind === 'video' && !detected.startsWith('video/')) return expected
  if (photo.kind === 'image' && !detected.startsWith('image/')) return expected
  return detected
}

async function blobForAsset(photo: PhotoAsset) {
  if (photo.blob) return photo.blob
  return dataUrlToBlob(photo.src)
}

async function uploadStorageObject(path: string, blob: Blob, fileName: string, contentType: string) {
  const client = requireSupabase()
  if (blob.size <= RESUMABLE_UPLOAD_THRESHOLD) {
    const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, {
      cacheControl: '31536000',
      contentType,
      upsert: false,
    })
    if (error) throw error
    return
  }

  const [{ Upload }, sessionResult] = await Promise.all([
    import('tus-js-client'),
    client.auth.getSession(),
  ])
  if (sessionResult.error) throw sessionResult.error
  const session = sessionResult.data.session
  if (!session) throw new Error('登录状态已失效，请重新登录')

  const configuredProjectUrl = import.meta.env.VITE_SUPABASE_URL
  if (!configuredProjectUrl) throw new Error('Supabase 项目地址尚未配置')
  const projectUrl = new URL(configuredProjectUrl)
  const projectId = projectUrl.hostname.split('.')[0]
  const uploadFile = blob instanceof File
    ? blob
    : new File([blob], fileName, { type: contentType })

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(uploadFile, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10_000, 20_000],
      fingerprint: () => Promise.resolve([
        'couple-memory',
        PHOTO_BUCKET,
        path,
        String(blob.size),
        contentType,
      ].join(':')),
      headers: {
        authorization: `Bearer ${session.access_token}`,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: PHOTO_BUCKET,
        objectName: path,
        contentType,
        cacheControl: '31536000',
      },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onSuccess: () => resolve(),
    })

    void upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0])
      upload.start()
    }).catch(reject)
  })
}

async function removeUnreferencedStorageObjects(paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))]
  if (!uniquePaths.length) return

  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from('memory_photos')
      .select('storage_path')
      .in('storage_path', uniquePaths)
    if (error) {
      console.warn('Could not verify whether media objects are still referenced', error)
      return
    }

    const referenced = new Set((data || []).map((row) => String(row.storage_path)))
    const retained = await client.rpc('retained_media_paths', { p_paths: uniquePaths })
    if (retained.error) { console.warn('无法核对回收站文件引用，保留原文件', retained.error); return }
    for (const path of retained.data || []) referenced.add(String(path))
    const removable = uniquePaths.filter((path) => !referenced.has(path))
    if (!removable.length) return

    const { error: removeError } = await client.storage.from(PHOTO_BUCKET).remove(removable)
    if (removeError) console.warn('Could not remove unreferenced media objects', removeError)
  } catch (error) {
    // A leaked object is safer than deleting an object still referenced by a row.
    console.warn('Could not finish safe media cleanup', error)
  }
}

function uploadedPath(coupleId: string, memoryId: string, photoId: string, extension: string) {
  return `${coupleId}/${memoryId}/${photoId}-${crypto.randomUUID()}.${extension}`
}

function mediaManifestItem(photo: PhotoAsset, storagePath: string, mimeType: string) {
  return {
    id: photo.id,
    storage_path: storagePath,
    ...cloudPhotoValues({ ...photo, mimeType }),
  }
}

function removedPathsFromResult(result: unknown) {
  if (!result || typeof result !== 'object' || !('removed_paths' in result)) return []
  const paths = (result as { removed_paths?: unknown }).removed_paths
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []
}

async function saveMemoryManifest(
  create: boolean,
  coupleId: string,
  memory: MemoryEntry,
  media: Array<Record<string, unknown>>,
) {
  const values = cloudMemoryValues(memory)
  const { data, error } = await requireSupabase().rpc('save_memory_with_media', {
    p_create: create,
    p_couple_id: coupleId,
    p_memory_id: memory.id,
    p_title: values.title,
    p_original_text: values.original_text,
    p_display_text: values.display_text,
    p_memory_date: values.memory_date,
    p_location: values.location,
    p_latitude: values.latitude,
    p_longitude: values.longitude,
    p_style: values.style,
    p_template: values.template,
    p_tags: values.tags,
    p_category: values.category,
    p_mood_emoji: values.mood_emoji,
    p_mood_text: values.mood_text,
    p_is_demo: values.is_demo,
    p_is_liked: values.is_liked,
    p_theme_color: values.theme_color,
    p_media: media,
  })
  if (error) throw error
  return removedPathsFromResult(data)
}

export async function putCloudMemory(coupleId: string, memory: MemoryEntry) {
  const uploadedPaths: string[] = []

  try {
    const photoRows: Array<Record<string, unknown>> = []
    for (const photo of memory.photos) {
      const blob = await blobForAsset(photo)
      const contentType = contentTypeForAsset(photo, blob)
      const extension = extensionForMime(contentType, photo.name)
      const path = uploadedPath(coupleId, memory.id, photo.id, extension)
      await uploadStorageObject(path, blob, photo.name, contentType)
      uploadedPaths.push(path)
      photoRows.push(mediaManifestItem(photo, path, contentType))
    }

    await saveMemoryManifest(true, coupleId, memory, photoRows)
  } catch (error) {
    await removeUnreferencedStorageObjects(uploadedPaths)
    throw new Error(messageFromError(error, '回忆保存失败'))
  }
}

export async function updateCloudMemory(
  coupleId: string,
  memory: MemoryEntry,
) {
  const client = requireSupabase()
  const existingResult = await client
    .from('memory_photos')
    .select('id,storage_path')
    .eq('memory_id', memory.id)
    .eq('couple_id', coupleId)
  if (existingResult.error) throw existingResult.error

  const existingById = new Map(existingResult.data.map((row) => [
    String(row.id),
    String(row.storage_path),
  ]))
  const uploadedPaths: string[] = []

  try {
    const prepared = new Map<string, { path: string; mimeType: string }>()
    for (const photo of memory.photos) {
      const existingPath = existingById.get(photo.id)
      if (existingPath) {
        prepared.set(photo.id, { path: existingPath, mimeType: photo.mimeType })
        continue
      }

      const blob = await blobForAsset(photo)
      const contentType = contentTypeForAsset(photo, blob)
      const extension = extensionForMime(contentType, photo.name)
      const path = uploadedPath(coupleId, memory.id, photo.id, extension)
      await uploadStorageObject(path, blob, photo.name, contentType)
      uploadedPaths.push(path)
      prepared.set(photo.id, { path, mimeType: contentType })
    }

    const media = memory.photos.map((photo) => {
      const preparedPhoto = prepared.get(photo.id)
      if (!preparedPhoto) throw new Error('媒体准备失败，请重试')
      return mediaManifestItem(photo, preparedPhoto.path, preparedPhoto.mimeType)
    })
    const removedPaths = await saveMemoryManifest(false, coupleId, memory, media)
    await removeUnreferencedStorageObjects(removedPaths)
  } catch (error) {
    await removeUnreferencedStorageObjects(uploadedPaths)
    throw new Error(messageFromError(error, '回忆更新失败'))
  }
}

export async function removeCloudMemory(coupleId: string, memory: MemoryEntry) {
  const client = requireSupabase()
    const { data, error } = await client
      .from('memories')
      .delete()
      .eq('id', memory.id)
      .eq('couple_id', coupleId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('没有找到这篇回忆，它可能已经被对方删除')
  // The BEFORE DELETE trigger archives the row and photo manifest atomically.
  // Physical files are retained until purgeCloudTrash finishes.
}

export async function saveCloudProfile(
  coupleId: string,
  currentUserId: string,
  profile: CoupleProfile,
  memberIds: string[],
) {
  const client = requireSupabase()
  const ownName = memberIds[0] === currentUserId ? profile.personA : profile.personB
  const [coupleResult, profileResult] = await Promise.all([
    client.from('couples').update({
      start_date: profile.startDate,
    }).eq('id', coupleId),
    client.from('profiles').update({ display_name: ownName.trim() }).eq('id', currentUserId),
  ])
  if (coupleResult.error) throw coupleResult.error
  if (profileResult.error) throw profileResult.error
}

export async function createCloudAnniversary(
  coupleId: string,
  userId: string,
  anniversary: AnniversaryEntry,
) {
  const { error } = await requireSupabase().from('anniversaries').insert({
    id: anniversary.id,
    couple_id: coupleId,
    created_by: userId,
    title: anniversary.title.trim(),
    event_date: anniversary.date,
    repeats_yearly: anniversary.repeatsYearly,
    kind: anniversary.kind,
    note: anniversary.note.trim(),
  })
  if (error) throw new Error(messageFromError(error, '纪念日保存失败'))
}

export async function updateCloudAnniversary(
  coupleId: string,
  anniversary: AnniversaryEntry,
) {
  const { data, error } = await requireSupabase()
    .from('anniversaries')
    .update({
      title: anniversary.title.trim(),
      event_date: anniversary.date,
      repeats_yearly: anniversary.repeatsYearly,
      kind: anniversary.kind,
      note: anniversary.note.trim(),
    })
    .eq('couple_id', coupleId)
    .eq('id', anniversary.id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(messageFromError(error, '纪念日更新失败'))
  if (!data) throw new Error('没有找到这个纪念日，可能已经被对方删除')
}

export async function removeCloudAnniversary(coupleId: string, anniversaryId: string) {
  const { data, error } = await requireSupabase()
    .from('anniversaries')
    .delete()
    .eq('couple_id', coupleId)
    .eq('id', anniversaryId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(messageFromError(error, '纪念日删除失败'))
  if (!data) throw new Error('没有找到这个纪念日，页面已经为你刷新')
}

export async function createCloudMessage(coupleId: string, userId: string, message: MessageItem) {
  void userId // auth.uid() is authoritative inside the idempotent RPC.
  const { error } = await requireSupabase().rpc('create_message_once', {
    p_id: message.id,
    p_couple_id: coupleId,
    p_text: message.text.trim(),
    p_reveal_at: message.revealAt,
  })
  if (error) throw new Error(messageFromError(error, '留言保存失败'))
}

export async function addCloudMessageReply(
  _coupleId: string,
  _userId: string,
  messageId: string,
  reply: MessageReply,
) {
  // RPC 内做成员校验与原子追加；messages 表对客户端保持无 UPDATE 授权。
  const { error } = await requireSupabase().rpc('append_message_reply', {
    p_message_id: messageId,
    p_reply_id: reply.id,
    p_text: reply.text.trim(),
  })
  if (error) throw new Error(messageFromError(error, '回复发送失败'))
}

export async function removeCloudMessage(coupleId: string, messageId: string) {
  const { data, error } = await requireSupabase()
    .from('messages')
    .delete()
    .eq('couple_id', coupleId)
    .eq('id', messageId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(messageFromError(error, '留言删除失败'))
  if (!data) throw new Error('没有找到这条留言，可能已经被对方删除')
}

export async function syncCloudWishes(
  coupleId: string,
  userId: string,
  previous: WishItem[],
  next: WishItem[],
) {
  const client = requireSupabase()
  const previousById = new Map(previous.map((wish) => [wish.id, wish]))
  const nextIds = new Set(next.map((wish) => wish.id))
  const removed = previous.filter((wish) => !nextIds.has(wish.id)).map((wish) => wish.id)
  const created = next.filter((wish) => !previousById.has(wish.id))
  const updated = next.filter((wish) => {
    const old = previousById.get(wish.id)
    return Boolean(old && (old.text !== wish.text || old.completed !== wish.completed || old.category !== wish.category))
  })

  if (created.length) {
    const { error } = await client.from('wishes').insert(created.map((wish) => ({
      id: wish.id,
      couple_id: coupleId,
      created_by: wish.createdBy || userId,
      text: wish.text,
      completed: wish.completed,
      category: wish.category,
      completed_at: wish.completed ? new Date().toISOString() : null,
    })))
    if (error) throw error
  }
  for (const wish of updated) {
    const { error } = await client.from('wishes').update({
      text: wish.text,
      completed: wish.completed,
      category: wish.category,
      completed_at: wish.completed ? new Date().toISOString() : null,
    }).eq('couple_id', coupleId).eq('id', wish.id)
    if (error) throw error
  }
  if (removed.length) {
    const { error } = await client.from('wishes').delete().eq('couple_id', coupleId).in('id', removed)
    if (error) throw error
  }
}

export async function saveCloudMessageNotes(coupleId: string, notes: MessageNotes) {
  const client = requireSupabase()
  const values = {
    likes: notes.likes.trim(),
    dislikes: notes.dislikes.trim(),
  }
  // Only likes/dislikes have UPDATE grants; upsert would also update couple_id.
  const updateExisting = async () => {
    const { data, error } = await client.from('couple_notes')
      .update(values)
      .eq('couple_id', coupleId)
      .select('couple_id')
    if (error) throw error
    return Boolean(data?.length)
  }

  try {
    if (await updateExisting()) return
    const { error } = await client.from('couple_notes').insert({ couple_id: coupleId, ...values })
    if (!error) return
    if (error.code !== '23505') throw error
    // The partner may have created the row after our UPDATE found no rows.
    if (!await updateExisting()) throw new Error('喜好备忘保存失败，请刷新后重试')
  } catch (error) {
    throw new Error(messageFromError(error, '喜好备忘保存失败'))
  }
}

export function subscribeToCloudWorkspace(coupleId: string, onChange: () => void): CloudWatchHandle {
  const client = requireSupabase()
  let closed = false
  const notifyChange = () => {
    if (!closed) onChange()
  }
  // With the existing replica identity, DELETE payloads cannot be filtered by couple_id.
  // Treat them only as invalidation signals; workspace reloads still enforce member RLS.
  const channel: RealtimeChannel = client
    // Each handle owns a channel, including when a previous channel is still leaving.
    .channel(`couple:${coupleId}:${++workspaceChannelSequence}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couples', filter: `id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'couples' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'couple_members', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couple_members', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'couple_members' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memories', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'memories', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'memories' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memory_photos', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'memory_photos', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'memory_photos' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wishes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wishes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wishes' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'anniversaries', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'anniversaries', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'anniversaries' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'couple_notes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couple_notes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'couple_notes' }, notifyChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partner_notes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'partner_notes', filter: `couple_id=eq.${coupleId}` }, notifyChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'partner_notes' }, notifyChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, notifyChange)
    .subscribe()

  return {
    close: () => {
      if (closed) return
      closed = true
      void client.removeChannel(channel)
    },
  }
}

export function unsubscribeCloudWorkspace(handle: CloudWatchHandle) {
  void handle.close()
}
