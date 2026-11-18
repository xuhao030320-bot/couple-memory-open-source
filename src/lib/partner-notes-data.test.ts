import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalPartnerNotes, legacyPartnerNotes, sortPartnerNotes, updateLocalPartnerNotes, validatePartnerNoteInput } from './partner-notes-data'
import type { PartnerNote } from '../types'

describe('independent partner notes storage', () => {
  let data: Map<string, string>
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    data = new Map()
    storage = { getItem: vi.fn((key: string) => data.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { data.set(key, value) }) }
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('migrates old lines without inventing a publication time or changing the source', () => {
    const raw = JSON.stringify({ likes: '草莓蛋糕\r\n\r\n靠窗', dislikes: '咖啡少冰' })
    data.set('only-us-message-notes:local', raw)
    const rows = getLocalPartnerNotes()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.legacy && row.createdAt === null)).toBe(true)
    expect(rows.map((row) => row.kind).sort()).toEqual(['care', 'like', 'like'])
    expect(data.get('only-us-message-notes:local')).toBe(raw)
  })
  it('does not resurrect deleted migrated notes on reload', () => {
    data.set('only-us-message-notes:local', JSON.stringify({ likes: '旧内容', dislikes: '' }))
    getLocalPartnerNotes()
    updateLocalPartnerNotes('local', () => [])
    expect(getLocalPartnerNotes()).toEqual([])
  })
  it('keeps duplicate lines as different historical entries and entire old paragraphs', () => {
    const rows = legacyPartnerNotes({ likes: '喜欢。还有一件事！\n喜欢。还有一件事！', dislikes: '' })
    expect(rows[0].text).toBe('喜欢。还有一件事！')
    expect(rows[0].id).not.toBe(rows[1].id)
  })
  it('sorts published notes newest first with unknown historical times at the end', () => {
    const notes: PartnerNote[] = [
      { id: 'legacy', text: '历史', kind: 'like', createdAt: null },
      { id: 'old', text: '之前', kind: 'like', createdAt: '2026-01-01T10:00:00Z' },
      { id: 'new', text: '后来', kind: 'care', createdAt: '2026-02-01T10:00:00Z' },
    ]
    expect(sortPartnerNotes(notes).map((row) => row.id)).toEqual(['new', 'old', 'legacy'])
    expect(notes[0].id).toBe('legacy')
  })
  it('reads the latest list before a mutation instead of overwriting another note', () => {
    const first: PartnerNote = { id: 'a', text: '第一条', kind: 'like', createdAt: '2026-10-02T10:00:00Z' }
    const second: PartnerNote = { id: 'b', text: '第二条', kind: 'care', createdAt: '2026-10-02T11:00:00Z' }
    updateLocalPartnerNotes('local', () => [first])
    updateLocalPartnerNotes('local', (rows) => [...rows, second])
    const changed = updateLocalPartnerNotes('local', (rows) => rows.map((row) => row.id === 'a' ? { ...row, text: '已编辑' } : row))
    expect(changed.map((row) => row.id)).toEqual(['b', 'a'])
    expect(changed[1].createdAt).toBe(first.createdAt)
  })
  it('isolates couple spaces and does not overwrite malformed stored data', () => {
    data.set('only-us-partner-note-entries:a', 'broken')
    expect(() => getLocalPartnerNotes('a')).toThrow('原数据已保留')
    expect(getLocalPartnerNotes('b')).toEqual([])
    expect(data.get('only-us-partner-note-entries:a')).toBe('broken')
  })
  it('rejects a failed storage write without reporting success or changing saved rows', () => {
    getLocalPartnerNotes()
    storage.setItem.mockImplementation(() => { throw new Error('storage full') })
    expect(() => updateLocalPartnerNotes('local', () => [{ id: 'a', text: '未保存', kind: 'like', createdAt: '2026-10-02T10:00:00Z' }])).toThrow('storage full')
    expect(getLocalPartnerNotes()).toEqual([])
  })
  it('preserves multi-line content as one new note and validates content/category', () => {
    expect(validatePartnerNoteInput({ text: '  第一行\n第二行  ', kind: 'care' })).toEqual({ text: '第一行\n第二行', kind: 'care' })
    expect(() => validatePartnerNoteInput({ text: ' ', kind: 'like' })).toThrow()
    expect(() => validatePartnerNoteInput({ text: 'a'.repeat(1001), kind: 'like' })).toThrow()
    expect(() => validatePartnerNoteInput({ text: 'content', kind: 'other' as 'like' })).toThrow()
  })
})
