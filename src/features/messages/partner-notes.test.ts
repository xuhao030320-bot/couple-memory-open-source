import { describe, expect, it } from 'vitest'
import type { PartnerNote } from '../../types'
import {
  clearPartnerNotesDraft, clearSavedPartnerNotesDraft, createNoteEditorState, emptyNoteInput,
  formatPartnerNoteTime, isNoteDraftDirty, orderPartnerNotesNewestFirst, readPartnerNotesDraft,
  sameNoteInput, writePartnerNotesDraft, type PartnerNoteDraft,
} from './partner-notes'

function storageFixture() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}
function draft(overrides: Partial<PartnerNoteDraft> = {}): PartnerNoteDraft {
  return { input: { text: '草莓蛋糕\n靠窗的位置', kind: 'like' }, baseline: emptyNoteInput(), editingId: null, ...overrides }
}
function note(id: string, createdAt: string | null): PartnerNote {
  return { id, text: `备忘 ${id}`, kind: 'like', createdAt }
}

describe('individual note editor', () => {
  it('keeps multiline input as one note and restores the complete draft', () => {
    const multiline = draft()
    const state = createNoteEditorState([], multiline)
    expect(state.input).toEqual(multiline.input)
    expect(state.input.text).toBe('草莓蛋糕\n靠窗的位置')
    expect(state.restored).toBe(true)
    expect(state.editingId).toBeNull()
  })

  it('starts a clean empty draft and ignores drafts without unsaved changes', () => {
    const empty = { input: emptyNoteInput(), baseline: emptyNoteInput(), editingId: null }
    expect(createNoteEditorState([])).toEqual({ ...empty, restored: false })
    expect(createNoteEditorState([], empty)).toEqual({ ...empty, restored: false })
    expect(isNoteDraftDirty({ ...empty, input: { text: ' \n ', kind: 'care' } })).toBe(false)
    expect(isNoteDraftDirty(draft())).toBe(true)
  })

  it('detects edits including a category change without trimming away input', () => {
    const original = { text: '草莓蛋糕', kind: 'like' as const }
    expect(sameNoteInput(original, { ...original })).toBe(true)
    expect(isNoteDraftDirty(draft({ input: original, baseline: original, editingId: 'existing' }))).toBe(false)
    expect(isNoteDraftDirty(draft({ input: { ...original, kind: 'care' }, baseline: original, editingId: 'existing' }))).toBe(true)
    expect(sameNoteInput(original, { ...original, text: ' 草莓蛋糕 ' })).toBe(false)
  })

  it('keeps the original edit baseline when the official note changed remotely', () => {
    const saved = { ...note('existing', null), text: '远端更新' }
    const pending = draft({ editingId: saved.id, baseline: { text: '旧文字', kind: 'like' } })
    const state = createNoteEditorState([saved], pending)
    expect(state.editingId).toBe(saved.id)
    expect(state.baseline).toEqual(pending.baseline)
    expect(state.input).toEqual(pending.input)
  })

  it('preserves the text as a new note if the editing target was deleted', () => {
    const pending = draft({ editingId: 'deleted', baseline: { text: '原文字', kind: 'like' } })
    const state = createNoteEditorState([], pending)
    expect(state.editingId).toBeNull()
    expect(state.input).toEqual(pending.input)
    expect(state.restored).toBe(true)
    expect(isNoteDraftDirty(state)).toBe(true)
  })
})

describe('note timestamps', () => {
  it('formats the actual absolute date and time in the viewer’s local timezone', () => {
    const createdAt = new Date(2026, 9, 2, 16, 5, 30).toISOString()
    expect(formatPartnerNoteTime(createdAt)).toBe('2026年10月02日 16:05')
  })

  it.each([null, '', 'not-a-date'])('does not invent publication time for %s', (createdAt) => {
    expect(formatPartnerNoteTime(createdAt)).toBe('历史备忘 · 原发布时间未记录')
  })

  it('orders real timestamps newest first while leaving unknown times stably at the end', () => {
    const notes = [note('legacy', null), note('old', '2026-01-01T00:00:00Z'), note('invalid', 'bad'), note('new', '2026-10-02T00:00:00Z'), note('tie', '2026-10-02T00:00:00Z'), note('epoch', '1970-01-01T00:00:00Z')]
    const originalOrder = notes.map(({ id }) => id)
    expect(orderPartnerNotesNewestFirst(notes).map(({ id }) => id)).toEqual(['new', 'tie', 'old', 'epoch', 'legacy', 'invalid'])
    expect(notes.map(({ id }) => id)).toEqual(originalOrder)
  })
})

describe('note draft storage', () => {
  it('stores and restores one draft independently for each provider, space and account', () => {
    const storage = storageFixture()
    const scopes = ['local:local:', 'cloudbase:space-a:user-a', 'cloudbase:space-a:user-b', 'cloudbase:space-b:user-a', 'supabase:space-a:user-a']
    scopes.forEach((scope, index) => writePartnerNotesDraft(scope, draft({ input: { text: `草稿 ${index}`, kind: 'care' } }), storage))
    scopes.forEach((scope, index) => expect(readPartnerNotesDraft(scope, storage)?.input.text).toBe(`草稿 ${index}`))
    expect(readPartnerNotesDraft('supabase:other:account', storage)).toBeNull()
  })

  it('restores only dirty drafts', () => {
    const storage = storageFixture()
    const input = { text: '原文', kind: 'like' as const }
    writePartnerNotesDraft('scope', draft({ input, baseline: input, editingId: 'existing' }), storage)
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
    writePartnerNotesDraft('scope', draft({ input: { text: ' \n ', kind: 'care' } }), storage)
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
  })

  it('clears only the fully matching submitted snapshot, preserving newer changes', () => {
    const storage = storageFixture()
    const submitted = draft({ editingId: 'existing', baseline: { text: '原文', kind: 'like' } })
    writePartnerNotesDraft('scope', submitted, storage)
    writePartnerNotesDraft('other', draft(), storage)
    clearSavedPartnerNotesDraft('scope', submitted, storage)
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
    expect(readPartnerNotesDraft('other', storage)).toEqual(draft())

    for (const newer of [
      { ...submitted, input: { text: '后来输入的新文字', kind: 'like' as const } },
      { ...submitted, editingId: 'another-note' },
      { ...submitted, baseline: { text: '新基线', kind: 'like' as const } },
    ]) {
      writePartnerNotesDraft('scope', newer, storage)
      clearSavedPartnerNotesDraft('scope', submitted, storage)
      expect(readPartnerNotesDraft('scope', storage)).toEqual(newer)
    }
  })

  it('removes a cancelled draft without touching official notes', () => {
    const storage = storageFixture()
    storage.setItem('only-us-partner-notes', JSON.stringify([note('official', null)]))
    writePartnerNotesDraft('scope', draft(), storage)
    clearPartnerNotesDraft('scope', storage)
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
    expect(JSON.parse(storage.getItem('only-us-partner-notes') || '')).toEqual([note('official', null)])
  })

  it.each([
    [{ likes: '旧喜欢', dislikes: '忌口' }, { likes: '新喜欢\n靠窗', dislikes: '忌口' }, 'like', '新喜欢\n靠窗'],
    [{ likes: '蛋糕', dislikes: '旧忌口' }, { likes: '蛋糕', dislikes: '新忌口\n少冰' }, 'care', '新忌口\n少冰'],
  ] as const)('recovers a changed field from the previous whole-note draft', (baseline, oldDraft, kind, text) => {
    const storage = storageFixture()
    storage.setItem('only-us-partner-notes-draft:scope', JSON.stringify({ baseline, draft: oldDraft }))
    expect(readPartnerNotesDraft('scope', storage)?.input).toEqual({ text, kind })
  })

  it('recovers both changed old sections in a single titled draft without losing text', () => {
    const storage = storageFixture()
    const oldDraft = { likes: '喜欢'.repeat(500), dislikes: '需要留意'.repeat(250) }
    storage.setItem('only-us-partner-notes-draft:scope', JSON.stringify({ baseline: { likes: '旧喜欢', dislikes: '旧忌口' }, draft: oldDraft }))
    const recovered = readPartnerNotesDraft('scope', storage)
    expect(recovered?.input.text).toBe(`喜欢的事\n${oldDraft.likes}\n\n需要留意\n${oldDraft.dislikes}`)
    expect(recovered?.input.text.length).toBeGreaterThan(1000)
    expect(recovered?.editingId).toBeNull()
  })

  it.each(['{broken-json', '{}', '{"input":{"text":42,"kind":"like"}}', '{"input":{"text":"内容","kind":"invalid"},"baseline":{"text":"","kind":"like"},"editingId":null}'])('ignores invalid draft data %s', (raw) => {
    const storage = storageFixture()
    storage.setItem('only-us-partner-notes-draft:scope', raw)
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
  })

  it('does not throw when storage is unavailable', () => {
    const storage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(readPartnerNotesDraft('scope', storage)).toBeNull()
    expect(() => writePartnerNotesDraft('scope', draft(), storage)).not.toThrow()
    expect(() => clearPartnerNotesDraft('scope', storage)).not.toThrow()
    expect(() => clearSavedPartnerNotesDraft('scope', draft(), storage)).not.toThrow()
  })
})
