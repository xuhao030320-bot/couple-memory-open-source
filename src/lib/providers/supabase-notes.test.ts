import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageNotes } from '../../types'
import { saveCloudMessageNotes } from './supabase'

const { requireSupabase } = vi.hoisted(() => ({ requireSupabase: vi.fn() }))

vi.mock('../supabase', () => ({ requireSupabase }))

interface QueryError {
  code: string
  message: string
}

interface QueryResult {
  data: Array<{ couple_id: string }> | null
  error: QueryError | null
}

const coupleId = 'couple-current'
const draft: MessageNotes = { likes: '  草莓蛋糕\n靠窗的位置  ', dislikes: '  不吃香菜  ' }
const values: MessageNotes = { likes: '草莓蛋糕\n靠窗的位置', dislikes: '不吃香菜' }
const updated: QueryResult = { data: [{ couple_id: coupleId }], error: null }
const missing: QueryResult = { data: [], error: null }
const inserted: QueryResult = { data: null, error: null }
const permissionDenied: QueryError = { code: '42501', message: 'permission denied for column couple_id' }
const uniqueConflict: QueryResult = {
  data: null,
  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
}

function mockNotesClient(updateResults: QueryResult[], insertResult = inserted) {
  const results = [...updateResults]
  const queries: Array<{ eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }> = []
  const update = vi.fn((payload: Record<string, unknown>) => {
    // Existing deployments grant UPDATE only on likes/dislikes, never couple_id.
    const result = 'couple_id' in payload ? { data: null, error: permissionDenied } : results.shift()
    if (!result) throw new Error('Unexpected notes UPDATE')
    const select = vi.fn(async (_columns: string) => result)
    const eq = vi.fn((_column: string, _id: string) => ({ select }))
    queries.push({ eq, select })
    return { eq }
  })
  // INSERT succeeds without a select: Supabase returns null data by default.
  const insert = vi.fn(async (_payload: Record<string, unknown>) => insertResult)
  const upsert = vi.fn(async () => ({ data: null, error: permissionDenied }))
  const from = vi.fn((_table: string) => ({ update, insert, upsert }))
  requireSupabase.mockReturnValue({ from })
  return { from, update, insert, upsert, queries }
}

describe('Supabase couple notes saving with restricted column permissions', () => {
  let client: ReturnType<typeof mockNotesClient>

  beforeEach(() => {
    requireSupabase.mockReset()
  })

  afterEach(() => {
    expect(client.upsert).not.toHaveBeenCalled()
    for (const [table] of client.from.mock.calls) expect(table).toBe('couple_notes')
    for (const [payload] of client.update.mock.calls) expect(payload).toEqual(values)
    for (const query of client.queries) {
      expect(query.eq).toHaveBeenCalledExactlyOnceWith('couple_id', coupleId)
      expect(query.select).toHaveBeenCalledExactlyOnceWith('couple_id')
    }
  })

  it('updates an existing row using only trimmed likes and dislikes', async () => {
    client = mockNotesClient([updated])

    await expect(saveCloudMessageNotes(coupleId, draft)).resolves.toBeUndefined()

    expect(client.update).toHaveBeenCalledExactlyOnceWith(values)
    expect(client.insert).not.toHaveBeenCalled()
    expect(draft).toEqual({ likes: '  草莓蛋糕\n靠窗的位置  ', dislikes: '  不吃香菜  ' })
  })

  it('creates the first row when the update returns no rows', async () => {
    client = mockNotesClient([missing])

    await expect(saveCloudMessageNotes(coupleId, draft)).resolves.toBeUndefined()

    expect(client.update).toHaveBeenCalledOnce()
    expect(client.insert).toHaveBeenCalledExactlyOnceWith({ couple_id: coupleId, ...values })
    expect(client.update.mock.invocationCallOrder[0]).toBeLessThan(client.insert.mock.invocationCallOrder[0])
  })

  it('retries the restricted update after another writer creates the row', async () => {
    client = mockNotesClient([missing, updated], uniqueConflict)

    await expect(saveCloudMessageNotes(coupleId, draft)).resolves.toBeUndefined()

    expect(client.update).toHaveBeenCalledTimes(2)
    expect(client.insert).toHaveBeenCalledExactlyOnceWith({ couple_id: coupleId, ...values })
    expect(client.update.mock.invocationCallOrder[0]).toBeLessThan(client.insert.mock.invocationCallOrder[0])
    expect(client.insert.mock.invocationCallOrder[0]).toBeLessThan(client.update.mock.invocationCallOrder[1])
  })

  it('rejects an initial update failure without attempting to create a row', async () => {
    client = mockNotesClient([{ data: null, error: { code: '42501', message: 'notes update denied' } }])

    await expect(saveCloudMessageNotes(coupleId, draft)).rejects.toThrow('notes update denied')

    expect(client.update).toHaveBeenCalledOnce()
    expect(client.insert).not.toHaveBeenCalled()
  })

  it('rejects a non-unique creation error without retrying the update', async () => {
    client = mockNotesClient([missing], {
      data: null,
      error: { code: '42501', message: 'notes insert denied' },
    })

    await expect(saveCloudMessageNotes(coupleId, draft)).rejects.toThrow('notes insert denied')

    expect(client.update).toHaveBeenCalledOnce()
    expect(client.insert).toHaveBeenCalledExactlyOnceWith({ couple_id: coupleId, ...values })
  })

  it('rejects an update failure while retrying a creation race', async () => {
    client = mockNotesClient([
      missing,
      { data: null, error: { code: '42501', message: 'notes retry denied' } },
    ], uniqueConflict)

    await expect(saveCloudMessageNotes(coupleId, draft)).rejects.toThrow('notes retry denied')

    expect(client.update).toHaveBeenCalledTimes(2)
    expect(client.insert).toHaveBeenCalledOnce()
  })

  it('rejects when the retry still affects no rows', async () => {
    client = mockNotesClient([missing, missing], uniqueConflict)

    await expect(saveCloudMessageNotes(coupleId, draft)).rejects.toThrow('喜好备忘保存失败')

    expect(client.update).toHaveBeenCalledTimes(2)
    expect(client.insert).toHaveBeenCalledOnce()
  })
})
