import { toISODate } from '../../lib/date'
import type { LayoutStyle, LayoutTemplate, MemoryCategory, MemoryEntry, PhotoAsset } from '../../types'
import { nextLayoutTemplate } from './memory'

export interface ComposeDraft {
  title: string
  text: string
  date: string
  location: string
  latitude?: number
  longitude?: number
  category: MemoryCategory
  moodEmoji: string
  moodText: string
  themeColor: string
  style: LayoutStyle
  template: LayoutTemplate
  tags: string[]
  photos?: PhotoAsset[]
}

export interface ComposerFields extends ComposeDraft {
  photos: PhotoAsset[]
}

function composerFields(memory: MemoryEntry | null, draft: ComposeDraft | null, today: string): ComposerFields {
  // 先选整份来源，旧回忆中的空值或缺失值不能借用另一篇新增草稿。
  const source = memory ?? draft
  return {
    title: source?.title ?? '',
    text: memory ? memory.displayText || memory.originalText || '' : draft?.text ?? '',
    date: source?.date || today,
    location: source?.location ?? '',
    latitude: source?.latitude,
    longitude: source?.longitude,
    category: source?.category || 'daily',
    moodEmoji: source?.moodEmoji ?? '🥰',
    moodText: source?.moodText ?? '',
    themeColor: source?.themeColor ?? '',
    style: source?.style || 'cream',
    template: source?.template || 'hero-note',
    photos: memory?.photos || draft?.photos || [],
    tags: source?.tags || [],
  }
}

export function createComposerInitialState(
  memory: MemoryEntry | null,
  draft: ComposeDraft | null,
  reroll = false,
  today = toISODate(new Date()),
) {
  const fields = composerFields(memory, draft, today)
  if (memory && reroll) fields.template = nextLayoutTemplate(fields.template, fields.photos.length)

  return {
    fields,
    // 恢复的新草稿仍算未保存；重新排版与原回忆比较，避免丢失离开提醒。
    baseline: composerFields(memory, null, today),
    restoredFromDraft: !memory && Boolean(draft) && draftFingerprint(fields) !== draftFingerprint(composerFields(null, null, today)),
  }
}

export function draftFingerprint(input: ComposerFields) {
  return JSON.stringify({
    ...input,
    title: input.title.trim() ? input.title : '',
    text: input.text.trim() ? input.text : '',
    location: input.location.trim() ? input.location : '',
    moodText: input.moodText.trim() ? input.moodText : '',
    photos: input.photos.map((photo) => ({
      id: photo.id,
      name: photo.name,
      alt: photo.alt,
      caption: photo.caption,
      order: photo.order,
      role: photo.role,
      focusX: photo.focusX,
      focusY: photo.focusY,
      kind: photo.kind,
      mimeType: photo.mimeType,
      storagePath: photo.storagePath || '',
    })),
  })
}
