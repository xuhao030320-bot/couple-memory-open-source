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
} from '../types'

export type DataProvider = 'local' | 'supabase' | 'cloudbase'

const configuredProvider = (import.meta.env.VITE_DATA_PROVIDER?.trim() || '').toLowerCase()
export const dataProvider: DataProvider = configuredProvider === 'cloudbase'
  ? 'cloudbase'
  : configuredProvider === 'supabase'
    ? 'supabase'
    : 'local'

/** 是否使用双人云端模式（supabase 或 cloudbase）。原 useSupabase 的语义。 */
export const useCloud = dataProvider !== 'local'

export const isCloudConfigured = dataProvider === 'local'
  ? true
  : dataProvider === 'cloudbase'
    ? Boolean(import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim()
      && (import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_CLOUDBASE_ACCESS_KEY?.trim()))
    : Boolean(
      import.meta.env.VITE_SUPABASE_URL?.trim()
      && (
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        || import.meta.env.VITE_SUPABASE_ANON_KEY
        || ''
      ).trim(),
    )

/** App.tsx 用到的会话最小形状（与 Supabase Session 的结构兼容）。 */
export interface CloudUser {
  id: string
  email?: string | null
  /** Supabase 风格元数据；cloudbase 实现里与 userMetadata 同时填充。 */
  user_metadata: { display_name?: string }
  userMetadata?: { display_name?: string }
}

export interface CloudSession {
  user: CloudUser
}

/** 实时订阅句柄：Supabase 包装 removeChannel，CloudBase 聚合各集合的 watcher。 */
export interface CloudWatchHandle {
  close(): void | Promise<void>
}

export type TrashKind = 'memory' | 'wish' | 'anniversary' | 'message' | 'partner_note'
export interface CloudTrashItem {
  id: string
  kind: TrashKind
  title: string
  deletedAt: string
  expiresAt: string
  originalId?: string
}

/** 云端存储实现契约：supabase 与 cloudbase 两个 provider 必须导出相同签名。 */
export interface CloudStorageProvider {
  signInWithEmail(email: string, password: string): Promise<CloudSession | null>
  signUpWithEmail(displayName: string, email: string, password: string): Promise<{ user: CloudUser | null; session: CloudSession | null }>
  signOutCloud(): Promise<void>
  clearSdkSessionStorage(): void
  getCloudSession(): Promise<CloudSession | null>
  onCloudAuthChange(callback: (session: CloudSession | null) => void): () => void
  createCloudCouple(displayName: string, startDate: string): Promise<void>
  joinCloudCouple(displayName: string, inviteCode: string): Promise<void>
  loadCloudWorkspace(userId: string): Promise<CloudWorkspace | null>
  loadCloudMessages(coupleId: string): Promise<MessageItem[]>
  putCloudMemory(coupleId: string, memory: MemoryEntry): Promise<void>
  updateCloudMemory(coupleId: string, memory: MemoryEntry): Promise<void>
  removeCloudMemory(coupleId: string, memory: MemoryEntry): Promise<void>
  saveCloudProfile(coupleId: string, currentUserId: string, profile: CoupleProfile, memberIds: string[]): Promise<void>
  createCloudAnniversary(coupleId: string, userId: string, anniversary: AnniversaryEntry): Promise<void>
  updateCloudAnniversary(coupleId: string, anniversary: AnniversaryEntry): Promise<void>
  removeCloudAnniversary(coupleId: string, anniversaryId: string): Promise<void>
  createCloudMessage(coupleId: string, userId: string, message: MessageItem): Promise<void>
  removeCloudMessage(coupleId: string, messageId: string): Promise<void>
  addCloudMessageReply(coupleId: string, userId: string, messageId: string, reply: MessageReply): Promise<void>
  syncCloudWishes(coupleId: string, userId: string, previous: WishItem[], next: WishItem[]): Promise<void>
  saveCloudMessageNotes(coupleId: string, notes: MessageNotes): Promise<void>
  loadCloudPartnerNotes(coupleId: string): Promise<PartnerNote[]>
  createCloudPartnerNote(coupleId: string, input: PartnerNoteInput): Promise<PartnerNote>
  updateCloudPartnerNote(coupleId: string, id: string, input: PartnerNoteInput): Promise<PartnerNote>
  deleteCloudPartnerNote(coupleId: string, id: string): Promise<void>
  setCloudPartnerNotePinned(coupleId: string, id: string, pinned: boolean): Promise<PartnerNote>
  listCloudTrash(coupleId: string): Promise<CloudTrashItem[]>
  restoreCloudTrash(coupleId: string, id: string): Promise<void>
  purgeCloudTrash(coupleId: string, id: string): Promise<void>
  subscribeToCloudWorkspace(coupleId: string, onChange: () => void): CloudWatchHandle
  unsubscribeCloudWorkspace(handle: CloudWatchHandle): void
  extensionForMime(mimeType: string, name: string): string
  contentTypeForAsset(photo: PhotoAsset, blob: Blob): string
}
