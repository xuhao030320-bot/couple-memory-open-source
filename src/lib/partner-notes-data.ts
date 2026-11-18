import type { MessageNotes, PartnerNote, PartnerNoteInput } from '../types'
import { getMessageNotes } from './storage'

const KEY = 'only-us-partner-note-entries'

function storageKey(scope: string) { return `${KEY}:${encodeURIComponent(scope || 'local')}` }

export function validatePartnerNoteInput(input: PartnerNoteInput): PartnerNoteInput {
  if (typeof input?.text !== 'string') throw new Error('请填写备忘内容')
  const text = input.text.trim()
  if (!text || text.length > 1000) throw new Error('备忘内容请填写 1–1000 个字')
  if (input.kind !== 'like' && input.kind !== 'care') throw new Error('请选择备忘分类')
  return { text, kind: input.kind }
}

export function sortPartnerNotes(notes: PartnerNote[]): PartnerNote[] {
  return [...notes].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    const aTime = a.createdAt ? Date.parse(a.createdAt) : NaN
    const bTime = b.createdAt ? Date.parse(b.createdAt) : NaN
    const difference = (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity)
    return Number.isNaN(difference) || difference === 0 ? a.id.localeCompare(b.id) : difference
  })
}

export function legacyPartnerNotes(notes: MessageNotes): PartnerNote[] {
  return (['likes', 'dislikes'] as const).flatMap((field) => (
    notes[field].split(/\r\n|\n|\r/).flatMap((line, index) => {
      const text = line.trim()
      return text ? [{ id: `legacy-${field}-${index}`, text, kind: field === 'likes' ? 'like' as const : 'care' as const, createdAt: null, legacy: true }] : []
    })
  ))
}

export function getLocalPartnerNotes(scope = 'local'): PartnerNote[] {
  const raw = localStorage.getItem(storageKey(scope))
  if (raw !== null) {
    try {
      const rows: unknown = JSON.parse(raw)
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== 'string' || typeof row.text !== 'string'
        || !['like', 'care'].includes(row.kind) || (row.createdAt !== null && typeof row.createdAt !== 'string'))) throw new Error()
      return sortPartnerNotes(rows)
    } catch { throw new Error('本地备忘读取失败，原数据已保留，请勿重复保存') }
  }
  const migrated = legacyPartnerNotes(getMessageNotes(scope))
  // 持久化空列表也代表迁移已完成，删除历史条目后不会再次导入。
  try { savePartnerNotesCache(scope, migrated) } catch { /* 仍可阅读，正式写入会报告存储失败。 */ }
  return migrated
}

export function savePartnerNotesCache(scope: string, notes: PartnerNote[]) {
  localStorage.setItem(storageKey(scope), JSON.stringify(sortPartnerNotes(notes)))
}

export function updateLocalPartnerNotes(scope: string, mutate: (notes: PartnerNote[]) => PartnerNote[]) {
  const next = sortPartnerNotes(mutate(getLocalPartnerNotes(scope)))
  savePartnerNotesCache(scope, next)
  return next
}
