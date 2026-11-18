import { describe, expect, it } from 'vitest'
import type { PartnerNote } from '../../types'
import { filterPartnerNotes, groupPartnerNotesByDate, orderPartnerNotesNewestFirst } from './partner-notes'

function note(id: string, changes: Partial<PartnerNote> = {}): PartnerNote {
  return { id, text: id, kind: 'like', createdAt: new Date(2026, 9, 19, 12).toISOString(), ...changes }
}

describe('browsing partner notes', () => {
  it('sorts pins first and then publication time without changing records or input order', () => {
    const notes = [
      note('recent'), note('legacy-pin', { pinned: true, createdAt: null, legacy: true }),
      note('old-pin', { pinned: true, createdAt: new Date(2026, 9, 1, 12).toISOString() }),
      note('new-pin', { pinned: true }), note('old', { createdAt: new Date(2026, 8, 1, 12).toISOString() }),
    ]
    const before = JSON.stringify(notes)
    expect(orderPartnerNotesNewestFirst(notes).map(({ id }) => id)).toEqual(['new-pin', 'old-pin', 'legacy-pin', 'recent', 'old'])
    expect(JSON.stringify(notes)).toBe(before)
    expect(orderPartnerNotesNewestFirst(notes.map((entry) => ({ ...entry, pinned: false })))[0].id).toBe('recent')
  })

  it('combines trimmed, case-insensitive text search with category filters', () => {
    const notes = [note('like', { text: '喜欢 COFFEE\n靠窗的位置' }), note('care', { text: 'Coffee 别太烫', kind: 'care' }), note('full-width', { text: 'ＣＯＦＦＥＥ' })]
    expect(filterPartnerNotes(notes, ' coffee ', 'all').map(({ id }) => id)).toEqual(['like', 'care', 'full-width'])
    expect(filterPartnerNotes(notes, 'Coffee', 'care').map(({ id }) => id)).toEqual(['care'])
    expect(filterPartnerNotes(notes, '靠窗', 'like').map(({ id }) => id)).toEqual(['like'])
    expect(filterPartnerNotes(notes, '没有的词', 'all')).toEqual([])
    expect(filterPartnerNotes(notes, '', 'all')).toEqual(notes)
  })

  it('groups local dates while keeping pinned and regular sections separate', () => {
    const notes = orderPartnerNotesNewestFirst([
      note('pin', { pinned: true }), note('regular'),
      note('yesterday', { createdAt: new Date(2026, 9, 18, 23, 59).toISOString() }),
      note('unknown', { createdAt: null, legacy: true }), note('invalid', { createdAt: 'not-a-date' }),
    ])
    const groups = groupPartnerNotesByDate(notes)
    expect(groups.map(({ label }) => label)).toEqual(['置顶 · 2026年10月19日', '2026年10月19日', '2026年10月18日', '历史备忘'])
    expect(groups.flatMap((group) => group.notes.map(({ id }) => id))).toEqual(notes.map(({ id }) => id))
    expect(groups.at(-1)?.notes.map(({ id }) => id)).toEqual(['unknown', 'invalid'])
    expect(groups[0].key).not.toBe(groups[1].key)
  })
})
