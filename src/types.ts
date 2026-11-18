export type AppView = 'home' | 'memories' | 'compose' | 'anniversaries' | 'messages' | 'us'

export type LayoutStyle = 'cream' | 'film' | 'minimal' | 'ticket'

export type LayoutTemplate =
  | 'hero-note'
  | 'hero-grid'
  | 'film-strip'
  | 'quiet-column'
  | 'grid-4'
  | 'grid-6'
  | 'grid-9'

export type MemoryCategory = 'daily' | 'travel' | 'anniversary'

export type MediaKind = 'image' | 'video'

export interface PhotoAsset {
  id: string
  src: string
  name: string
  alt: string
  caption: string
  order: number
  role: 'cover' | 'supporting'
  focusX: number
  focusY: number
  kind: MediaKind
  mimeType: string
  storagePath?: string
  /** Original local media, kept out of database rows and used for upload. */
  blob?: Blob
}

export interface MemoryEntry {
  id: string
  title: string
  originalText: string
  displayText: string
  date: string
  location: string
  latitude?: number
  longitude?: number
  style: LayoutStyle
  template: LayoutTemplate
  photos: PhotoAsset[]
  tags: string[]
  category: MemoryCategory
  moodEmoji: string
  moodText: string
  createdAt: string
  isDemo?: boolean
  /** 「喜欢」标记，缺失时默认 false（normalizeMemory 兜底）。 */
  isLiked?: boolean
  /** 自定义氛围色（hex），覆盖排版的 --layout-accent；缺失时用风格默认色。 */
  themeColor?: string
}

export interface CoupleProfile {
  personA: string
  personB: string
  startDate: string
  nextMilestoneTitle?: string
  nextMilestoneDate?: string
}

export type AnniversaryKind = 'love' | 'birthday' | 'first' | 'trip' | 'custom'

export interface AnniversaryEntry {
  id: string
  title: string
  date: string
  repeatsYearly: boolean
  kind: AnniversaryKind
  note: string
  createdAt: string
  createdBy?: string
  isSystem?: boolean
}

export type WishCategory = 'long_term' | 'daily' | 'food'

export interface WishItem {
  id: string
  text: string
  completed: boolean
  category: WishCategory
  createdAt: string
  createdBy?: string
}

export interface MessageReply {
  id: string
  createdBy: string
  text: string
  createdAt: string
}

export interface MessageItem {
  id: string
  text: string
  /** ISO 时间戳；null 表示立刻可见。 */
  revealAt: string | null
  createdAt: string
  createdBy?: string
  /** 留言下的回复线程；可见性与父留言一致（一起揭开）。 */
  replies?: MessageReply[]
}

export interface MessageNotes {
  likes: string
  dislikes: string
}

export interface PartnerNoteInput {
  text: string
  kind: 'like' | 'care'
}

export interface PartnerNote extends PartnerNoteInput {
  id: string
  pinned?: boolean
  /** 历史整段备忘没有逐条发布时间，迁移时保留 null。 */
  createdAt: string | null
  createdBy?: string
  legacy?: boolean
}

export interface CloudWorkspace {
  coupleId: string
  inviteCode: string
  memberIds: string[]
  profile: CoupleProfile
  memories: MemoryEntry[]
  wishes: WishItem[]
  anniversaries: AnniversaryEntry[]
  messages: MessageItem[]
  messageNotes?: MessageNotes | null
  partnerNotes: PartnerNote[]
}
