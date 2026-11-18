import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudPartnerNote, deleteCloudPartnerNote, loadCloudPartnerNotes, updateCloudPartnerNote, setCloudPartnerNotePinned } from './supabase'

const { requireSupabase } = vi.hoisted(() => ({ requireSupabase: vi.fn() }))
vi.mock('../supabase', () => ({ requireSupabase }))

const row = { id: 'server-generated', text: '咖啡少冰\n喜欢靠窗', kind: 'care', created_at: '2026-10-02T10:30:12.123Z', created_by: 'member-a', legacy: false }
function mockClient(data: unknown = row, error: unknown = null) {
  const result = { data, error }
  const query = {
    insert: vi.fn((_values: unknown) => query),
    update: vi.fn((_values: unknown) => query),
    delete: vi.fn(() => query),
    select: vi.fn((_columns: string) => query),
    eq: vi.fn((_key: string, _value: string) => query),
    order: vi.fn((_key: string, _options: unknown) => query),
    range: vi.fn((_start: number, _end: number) => query),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: <T>(resolve: (value: typeof result) => T | PromiseLike<T>) => Promise.resolve(result).then(resolve),
  }
  const from = vi.fn((_name: string) => query)
  requireSupabase.mockReturnValue({ from })
  return { query, from }
}

describe('independent Supabase partner notes', () => {
  beforeEach(() => requireSupabase.mockReset())

  it('changes only pinned within the current couple and retains server time and author', async () => {
    const { query } = mockClient({ ...row, pinned: true })
    const note = await setCloudPartnerNotePinned('couple-a', row.id, true)
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ pinned: true })
    expect(query.eq.mock.calls).toEqual([['couple_id', 'couple-a'], ['id', row.id]])
    expect(note).toMatchObject({ pinned: true, text: row.text, createdAt: row.created_at, createdBy: row.created_by })
  })

  it('lets the server generate ID, author and publication time and returns the canonical record', async () => {
    const { query, from } = mockClient()
    const result = await createCloudPartnerNote('couple-a', { text: `  ${row.text}  `, kind: 'care' })
    expect(from).toHaveBeenCalledWith('partner_notes')
    expect(query.insert).toHaveBeenCalledExactlyOnceWith({ couple_id: 'couple-a', text: row.text, kind: 'care' })
    expect(result).toEqual({ id: row.id, text: row.text, kind: 'care', createdAt: row.created_at, createdBy: row.created_by, legacy: false })
  })

  it('edits one entry in its own space using only mutable columns and preserves server publication time', async () => {
    const { query } = mockClient({ ...row, text: '已编辑' })
    const result = await updateCloudPartnerNote('couple-a', row.id, { text: ' 已编辑 ', kind: 'care' })
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ text: '已编辑', kind: 'care' })
    expect(query.eq.mock.calls).toEqual([['couple_id', 'couple-a'], ['id', row.id]])
    expect(result.createdAt).toBe(row.created_at)
    expect(result.createdBy).toBe(row.created_by)
  })

  it('does not report an invisible or deleted row as successfully edited', async () => {
    mockClient(null)
    await expect(updateCloudPartnerNote('couple-a', row.id, { text: '编辑', kind: 'like' })).rejects.toThrow('已被删除或无法访问')
  })

  it('deletes only a requested entry within the current couple and confirms a row was removed', async () => {
    const { query } = mockClient({ id: row.id })
    await expect(deleteCloudPartnerNote('couple-a', row.id)).resolves.toBeUndefined()
    expect(query.delete).toHaveBeenCalledOnce()
    expect(query.eq.mock.calls).toEqual([['couple_id', 'couple-a'], ['id', row.id]])
    expect(query.select).toHaveBeenCalledWith('id')
  })

  it('rejects a zero-row delete without fake success', async () => {
    mockClient(null)
    await expect(deleteCloudPartnerNote('couple-a', row.id)).rejects.toThrow('已被删除或无法访问')
  })

  it('loads by space, newest first, and keeps historical time unknown', async () => {
    const { query } = mockClient([row, { ...row, id: 'legacy', created_at: null, created_by: null, legacy: true }])
    const result = await loadCloudPartnerNotes('couple-a')
    expect(query.eq).toHaveBeenCalledWith('couple_id', 'couple-a')
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false, nullsFirst: false })
    expect(result[1]).toMatchObject({ createdAt: null, createdBy: undefined, legacy: true })
  })

  it('surfaces schema and permission errors without hiding saved notes behind an empty list', async () => {
    mockClient(null, { code: '42P01', message: 'partner_notes missing' })
    await expect(loadCloudPartnerNotes('couple-a')).rejects.toThrow('partner_notes missing')
    mockClient(null, { code: '42501', message: 'notes denied' })
    await expect(createCloudPartnerNote('couple-a', { text: '备忘', kind: 'like' })).rejects.toThrow('notes denied')
  })

  it('reads beyond a full page without silently losing older entries', async () => {
    const first = mockClient(Array.from({ length: 200 }, (_, index) => ({ ...row, id: `entry-${index}` })))
    const second = mockClient([{ ...row, id: 'last-entry', created_at: null, legacy: true }])
    requireSupabase.mockReturnValue({ from: vi.fn().mockReturnValueOnce(first.query).mockReturnValueOnce(second.query) })
    const result = await loadCloudPartnerNotes('couple-a')
    expect(result).toHaveLength(201)
    expect(first.query.range).toHaveBeenCalledWith(0, 199)
    expect(second.query.range).toHaveBeenCalledWith(200, 399)
    expect(result[200]).toMatchObject({ id: 'last-entry', createdAt: null })
  })

  it('rejects invalid input before making any request', async () => {
    const { from } = mockClient()
    await expect(createCloudPartnerNote('couple-a', { text: ' ', kind: 'like' })).rejects.toThrow()
    await expect(updateCloudPartnerNote('couple-a', row.id, { text: 'a'.repeat(1001), kind: 'care' })).rejects.toThrow()
    expect(from).not.toHaveBeenCalled()
  })
})
