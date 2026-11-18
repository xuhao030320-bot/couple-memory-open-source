import type {
  LayoutTemplate,
  MediaKind,
  MemoryCategory,
  MemoryEntry,
  PhotoAsset,
} from '../../types'

export const MEMORY_CATEGORIES: Array<{
  id: MemoryCategory
  label: string
  description: string
}> = [
  { id: 'daily', label: '日常', description: '一起吃饭、散步和普通的小幸福' },
  { id: 'travel', label: '旅行', description: '出发、抵达和看过的风景' },
  { id: 'anniversary', label: '纪念日', description: '值得认真收藏的特别日子' },
]

const CATEGORY_LABELS = new Map(MEMORY_CATEGORIES.map((item) => [item.id, item.label]))
const CATEGORY_IDS = new Set<MemoryCategory>(MEMORY_CATEGORIES.map((item) => item.id))
const CATEGORY_TAGS = new Set(MEMORY_CATEGORIES.map((item) => item.label))

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && CATEGORY_IDS.has(value as MemoryCategory)
}

export function inferMemoryCategory(memory: Pick<MemoryEntry, 'tags'> & { category?: unknown }): MemoryCategory {
  if (isMemoryCategory(memory.category)) return memory.category
  if (memory.tags.some((tag) => tag.includes('纪念日') || tag.includes('周年') || tag.includes('生日'))) {
    return 'anniversary'
  }
  if (memory.tags.some((tag) => tag.includes('旅行') || tag.includes('旅途') || tag.includes('出发'))) {
    return 'travel'
  }
  return 'daily'
}

export function tagsWithCategory(tags: string[], category: MemoryCategory) {
  const categoryLabel = CATEGORY_LABELS.get(category) || '日常'
  return [categoryLabel, ...tags.filter((tag) => !CATEGORY_TAGS.has(tag))]
    .filter((tag, index, all) => tag.trim() && all.indexOf(tag) === index)
    .slice(0, 4)
}

export function inferMediaKind(mimeType = '', name = ''): MediaKind {
  if (mimeType.toLowerCase().startsWith('video/')) return 'video'
  return /\.(mp4|mov|m4v|webm)$/i.test(name) ? 'video' : 'image'
}

export function normalizePhotoAsset(photo: PhotoAsset): PhotoAsset {
  const kind = photo.kind || inferMediaKind(photo.mimeType, photo.name)
  const hasStoredBlob = typeof Blob !== 'undefined' && photo.blob instanceof Blob
  return {
    ...photo,
    src: hasStoredBlob && !photo.src ? URL.createObjectURL(photo.blob as Blob) : photo.src,
    kind,
    mimeType: photo.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
  }
}

export function normalizeMemory(memory: MemoryEntry): MemoryEntry {
  const category = inferMemoryCategory(memory)
  const latitude = typeof memory.latitude === 'number' ? memory.latitude : Number.NaN
  const longitude = typeof memory.longitude === 'number' ? memory.longitude : Number.NaN
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)

  return {
    ...memory,
    category,
    tags: tagsWithCategory(memory.tags || [], category),
    photos: (memory.photos || []).map(normalizePhotoAsset),
    moodEmoji: typeof memory.moodEmoji === 'string' ? memory.moodEmoji : '',
    moodText: typeof memory.moodText === 'string' ? memory.moodText : '',
    isLiked: memory.isLiked === true,
    latitude: hasCoordinates ? latitude : undefined,
    longitude: hasCoordinates ? longitude : undefined,
  }
}

export function nextLayoutTemplate(current: LayoutTemplate, mediaCount: number): LayoutTemplate {
  const templates: LayoutTemplate[] = mediaCount >= 3
    ? ['hero-grid', 'film-strip', 'hero-note', 'quiet-column']
    : ['hero-note', 'quiet-column', 'film-strip']
  const currentIndex = templates.indexOf(current)
  return templates[(currentIndex + 1 + templates.length) % templates.length]
}

export interface MemoryMonthGroup {
  key: string
  label: string
  memories: MemoryEntry[]
}

export function groupMemoriesByMonth(memories: MemoryEntry[]): MemoryMonthGroup[] {
  const groups = new Map<string, MemoryEntry[]>()
  for (const memory of memories) {
    const key = memory.date.slice(0, 7)
    const group = groups.get(key)
    if (group) group.push(memory)
    else groups.set(key, [memory])
  }

  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, items]) => ({
      key,
      label: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' })
        .format(new Date(`${key}-01T00:00:00`)),
      memories: [...items].sort((left, right) => (
        right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)
      )),
    }))
}
