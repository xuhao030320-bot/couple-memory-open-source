import type { AnniversaryEntry, CoupleProfile, MemoryEntry, MessageItem, MessageNotes, PhotoAsset, WishItem } from '../types'
import { normalizeMemory } from '../features/memories/memory'
import { daysFromToday } from './date'

const DB_NAME = 'only-us-memory'
const DB_VERSION = 1
const MEMORY_STORE = 'memories'
const PROFILE_KEY = 'only-us-profile'
const WISHES_KEY = 'only-us-wishes'
const ANNIVERSARIES_KEY = 'only-us-anniversaries'
const MESSAGES_KEY = 'only-us-messages'
const MESSAGE_NOTES_KEY = 'only-us-message-notes'
const SEEDED_KEY = 'only-us-demo-seeded'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(MEMORY_STORE)) {
        database.createObjectStore(MEMORY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function demoPhoto(id: string, src: string, alt: string, order: number): PhotoAsset {
  return {
    id,
    src,
    name: `${id}.svg`,
    alt,
    caption: '',
    order,
    role: order === 0 ? 'cover' : 'supporting',
    focusX: 0.5,
    focusY: 0.5,
    kind: 'image',
    mimeType: 'image/svg+xml',
  }
}

function createDemoMemories(): MemoryEntry[] {
  return [
    {
      id: 'demo-sunset-walk',
      title: '晚风把一天吹得很慢',
      originalText: '没有特别的安排，只是沿着江边慢慢走。夕阳落下去的时候，我们刚好都没有说话。',
      displayText: '没有特别的安排，只是沿着江边慢慢走。夕阳落下去的时候，我们刚好都没有说话。',
      date: daysFromToday(-3),
      location: '江边步道',
      style: 'cream',
      template: 'hero-grid',
      photos: [
        demoPhoto('sunset', '/moments/sunset.svg', '落日下的江边', 0),
        demoPhoto('flowers', '/moments/flowers.svg', '路边的花', 1),
        demoPhoto('coffee', '/moments/coffee.svg', '一起喝的咖啡', 2),
      ],
      tags: ['散步', '日常'],
      category: 'daily',
      moodEmoji: '🥰',
      moodText: '晚风刚刚好',
      createdAt: new Date().toISOString(),
      isDemo: true,
    },
    {
      id: 'demo-small-trip',
      title: '坐上开往夏天的车',
      originalText: '临时决定的小旅行，没有攻略，也没有赶时间。车窗外一直下着小雨，但心情很好。',
      displayText: '临时决定的小旅行，没有攻略，也没有赶时间。车窗外一直下着小雨，但心情很好。',
      date: daysFromToday(-24),
      location: '沿海列车',
      style: 'film',
      template: 'film-strip',
      photos: [
        demoPhoto('train', '/moments/train.svg', '列车窗外的风景', 0),
        demoPhoto('sea', '/moments/sea.svg', '阴天的海', 1),
        demoPhoto('home', '/moments/home.svg', '晚上回到的小屋', 2),
      ],
      tags: ['旅行', '一起去过'],
      category: 'travel',
      moodEmoji: '🚆',
      moodText: '想把路途再走一遍',
      createdAt: new Date().toISOString(),
      isDemo: true,
    },
  ]
}

export async function getMemories() {
  const database = await openDatabase()
  const transaction = database.transaction(MEMORY_STORE, 'readonly')
  const request = transaction.objectStore(MEMORY_STORE).getAll()
  const memories = await new Promise<MemoryEntry[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as MemoryEntry[])
    request.onerror = () => reject(request.error)
  })
  database.close()

  if (memories.length === 0 && localStorage.getItem(SEEDED_KEY) !== 'true') {
    const demo = createDemoMemories()
    for (const memory of demo) await putMemory(memory)
    localStorage.setItem(SEEDED_KEY, 'true')
    return demo.sort((a, b) => b.date.localeCompare(a.date))
  }

  return memories.map(normalizeMemory).sort((a, b) => b.date.localeCompare(a.date))
}

export async function putMemory(memory: MemoryEntry) {
  const database = await openDatabase()
  const transaction = database.transaction(MEMORY_STORE, 'readwrite')
  const normalized = normalizeMemory(memory)
  transaction.objectStore(MEMORY_STORE).put({
    ...normalized,
    photos: normalized.photos.map((photo) => photo.blob ? { ...photo, src: '' } : photo),
  })
  await waitForTransaction(transaction)
  database.close()
}

export async function removeMemory(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction(MEMORY_STORE, 'readwrite')
  transaction.objectStore(MEMORY_STORE).delete(id)
  await waitForTransaction(transaction)
  database.close()
}

export function getProfile(): CoupleProfile {
  const stored = localStorage.getItem(PROFILE_KEY)
  if (stored) return JSON.parse(stored) as CoupleProfile
  return {
    personA: '你',
    personB: 'TA',
    startDate: daysFromToday(-730),
    nextMilestoneTitle: '下一次纪念日',
    nextMilestoneDate: daysFromToday(36),
  }
}

export function saveProfile(profile: CoupleProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function getWishes(): WishItem[] {
  const stored = localStorage.getItem(WISHES_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as WishItem[]
    return parsed.map((wish) => ({ ...wish, category: wish.category ?? 'long_term' }))
  }
  return [
    {
      id: 'demo-wish-1',
      text: '一起去看一次海上日出',
      completed: false,
      category: 'long_term',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'demo-wish-2',
      text: '学会做对方最喜欢的一道菜',
      completed: true,
      category: 'daily',
      createdAt: new Date().toISOString(),
    },
  ]
}

export function saveWishes(wishes: WishItem[]) {
  localStorage.setItem(WISHES_KEY, JSON.stringify(wishes))
}

export function getMessages(): MessageItem[] {
  const stored = localStorage.getItem(MESSAGES_KEY)
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored) as MessageItem[]
    return parsed
      .map((message) => ({ ...message, revealAt: message.revealAt ?? null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export function saveMessages(messages: MessageItem[]) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages))
}

function scopedKey(base: string, scope = 'local') {
  return `${base}:${encodeURIComponent(scope || 'local')}`
}

export function getMessageNotes(scope = 'local'): MessageNotes {
  try {
    const raw = localStorage.getItem(scopedKey(MESSAGE_NOTES_KEY, scope))
    if (!raw) return { likes: '', dislikes: '' }
    const parsed = JSON.parse(raw) as Partial<MessageNotes>
    return { likes: typeof parsed.likes === 'string' ? parsed.likes : '', dislikes: typeof parsed.dislikes === 'string' ? parsed.dislikes : '' }
  } catch {
    return { likes: '', dislikes: '' }
  }
}

export function saveMessageNotes(scope: string, notes: MessageNotes) {
  localStorage.setItem(scopedKey(MESSAGE_NOTES_KEY, scope), JSON.stringify(notes))
}

export function getAnniversaries(profile: CoupleProfile): AnniversaryEntry[] {
  const stored = localStorage.getItem(ANNIVERSARIES_KEY)
  if (stored) return JSON.parse(stored) as AnniversaryEntry[]

  const migrated = profile.nextMilestoneDate
    ? [{
        id: crypto.randomUUID(),
        title: profile.nextMilestoneTitle?.trim() || '重要的日子',
        date: profile.nextMilestoneDate,
        repeatsYearly: false,
        kind: 'custom' as const,
        note: '从原来的重要日期迁移',
        createdAt: new Date().toISOString(),
      }]
    : []

  localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(migrated))
  return migrated
}

export function saveAnniversaries(anniversaries: AnniversaryEntry[]) {
  localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(anniversaries))
}
