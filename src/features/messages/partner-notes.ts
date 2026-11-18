import type { PartnerNote } from '../../types'

export interface PartnerNoteInput {
  text: string
  kind: 'like' | 'care'
}

export interface PartnerNoteDraft {
  input: PartnerNoteInput
  baseline: PartnerNoteInput
  editingId: string | null
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type NoteEditorState = PartnerNoteDraft & { restored: boolean }
export type PartnerNoteFilter = 'all' | PartnerNoteInput['kind']
export const PARTNER_NOTES_PAGE_SIZE = 20

export interface PartnerNoteDateGroup {
  key: string
  label: string
  pinned: boolean
  notes: PartnerNote[]
}

export function emptyNoteInput(): PartnerNoteInput {
  return { text: '', kind: 'like' }
}

export function sameNoteInput(left: PartnerNoteInput, right: PartnerNoteInput): boolean {
  return left.text === right.text && left.kind === right.kind
}

export function isNoteDraftDirty(draft: PartnerNoteDraft): boolean {
  return draft.editingId === null ? Boolean(draft.input.text.trim()) : !sameNoteInput(draft.input, draft.baseline)
}

export function createNoteEditorState(notes: PartnerNote[], draft?: PartnerNoteDraft | null): NoteEditorState {
  if (draft && isNoteDraftDirty(draft)) {
    return {
      input: { ...draft.input },
      baseline: { ...draft.baseline },
      editingId: draft.editingId && notes.some((note) => note.id === draft.editingId) ? draft.editingId : null,
      restored: true,
    }
  }
  return { input: emptyNoteInput(), baseline: emptyNoteInput(), editingId: null, restored: false }
}

function noteTimestamp(createdAt: string | null): number {
  return typeof createdAt === 'string' && createdAt.trim() ? Date.parse(createdAt) : Number.NaN
}

export function orderPartnerNotesNewestFirst(notes: PartnerNote[]): PartnerNote[] {
  return notes.map((note, index) => ({ note, index, time: noteTimestamp(note.createdAt) }))
    .sort((left, right) => {
      const pinOrder = Number(right.note.pinned === true) - Number(left.note.pinned === true)
      if (pinOrder) return pinOrder
      const leftValid = Number.isFinite(left.time)
      const rightValid = Number.isFinite(right.time)
      if (leftValid && rightValid) return right.time - left.time || left.index - right.index
      if (leftValid !== rightValid) return leftValid ? -1 : 1
      return left.index - right.index
    })
    .map(({ note }) => note)
}

export function filterPartnerNotes(notes: PartnerNote[], search: string, kind: PartnerNoteFilter): PartnerNote[] {
  const query = search.trim().normalize('NFKC').toLocaleLowerCase()
  return notes.filter((note) => (kind === 'all' || note.kind === kind)
    && (!query || note.text.normalize('NFKC').toLocaleLowerCase().includes(query)))
}

/** Keep pin sections separate so grouping cannot move an unpinned note above pins. */
export function groupPartnerNotesByDate(notes: PartnerNote[]): PartnerNoteDateGroup[] {
  const groups: PartnerNoteDateGroup[] = []
  for (const note of notes) {
    const time = noteTimestamp(note.createdAt)
    const day = Number.isFinite(time) ? formatPartnerNoteTime(note.createdAt).split(' ')[0] : '历史备忘'
    const pinned = note.pinned === true
    const key = `${pinned ? 'pinned' : 'regular'}:${day}`
    const previous = groups[groups.length - 1]
    if (previous?.key === key) previous.notes.push(note)
    else groups.push({ key, label: `${pinned ? '置顶 · ' : ''}${day}`, pinned, notes: [note] })
  }
  return groups
}

export function formatPartnerNoteTime(createdAt: string | null): string {
  const timestamp = noteTimestamp(createdAt)
  if (!Number.isFinite(timestamp)) return '历史备忘 · 原发布时间未记录'
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function draftKey(scope: string): string {
  return `only-us-partner-notes-draft:${encodeURIComponent(scope)}`
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isInput(value: unknown): value is PartnerNoteInput {
  const input = object(value)
  return Boolean(input && typeof input.text === 'string' && (input.kind === 'like' || input.kind === 'care'))
}

function parseDraft(value: unknown): PartnerNoteDraft | null {
  const stored = object(value)
  if (!stored) return null
  if (isInput(stored.input) && isInput(stored.baseline)
    && (stored.editingId === null || (typeof stored.editingId === 'string' && Boolean(stored.editingId)))) {
    return { input: { ...stored.input }, baseline: { ...stored.baseline }, editingId: stored.editingId }
  }
  // Preserve unsaved text from the previous two-section editor instead of truncating it.
  const baseline = object(stored.baseline)
  const draft = object(stored.draft)
  if (!baseline || !draft || typeof baseline.likes !== 'string' || typeof baseline.dislikes !== 'string'
    || typeof draft.likes !== 'string' || typeof draft.dislikes !== 'string') return null
  const likesChanged = baseline.likes !== draft.likes
  const careChanged = baseline.dislikes !== draft.dislikes
  if (!likesChanged && !careChanged) return null
  if (likesChanged && careChanged) {
    const combine = (likes: string, care: string) => `喜欢的事\n${likes}\n\n需要留意\n${care}`
    return {
      input: { text: combine(draft.likes, draft.dislikes), kind: 'like' },
      baseline: { text: combine(baseline.likes, baseline.dislikes), kind: 'like' },
      editingId: null,
    }
  }
  const kind = likesChanged ? 'like' : 'care'
  return {
    input: { text: likesChanged ? draft.likes : draft.dislikes, kind },
    baseline: { text: likesChanged ? baseline.likes : baseline.dislikes, kind },
    editingId: null,
  }
}

export function readPartnerNotesDraft(scope: string, storage?: DraftStorage): PartnerNoteDraft | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(draftKey(scope))
    if (!raw) return null
    const draft = parseDraft(JSON.parse(raw))
    return draft && isNoteDraftDirty(draft) ? draft : null
  } catch { return null }
}

export function writePartnerNotesDraft(scope: string, draft: PartnerNoteDraft, storage?: DraftStorage): void {
  try { (storage ?? window.localStorage).setItem(draftKey(scope), JSON.stringify(draft)) }
  catch { /* Storage failures must not prevent editing or saving official notes. */ }
}

export function clearPartnerNotesDraft(scope: string, storage?: DraftStorage): void {
  try { (storage ?? window.localStorage).removeItem(draftKey(scope)) }
  catch { /* Storage may be unavailable. */ }
}

export function clearSavedPartnerNotesDraft(scope: string, submittedDraft: PartnerNoteDraft, storage?: DraftStorage): void {
  const stored = readPartnerNotesDraft(scope, storage)
  if (stored && stored.editingId === submittedDraft.editingId
    && sameNoteInput(stored.input, submittedDraft.input)
    && sameNoteInput(stored.baseline, submittedDraft.baseline)) clearPartnerNotesDraft(scope, storage)
}
