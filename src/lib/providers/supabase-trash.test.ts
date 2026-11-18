import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudMessage, listCloudTrash, purgeCloudTrash, removeCloudMemory, restoreCloudTrash } from './supabase'
import type { MemoryEntry } from '../../types'
const { requireSupabase } = vi.hoisted(() => ({ requireSupabase: vi.fn() }))
vi.mock('../supabase', () => ({ requireSupabase }))

function clientFor(data: unknown = { id: 'memory' }) {
  const result = { data, error: null }
  const query = {
    delete: vi.fn(() => query), select: vi.fn(() => query), eq: vi.fn(() => query),
    order: vi.fn(() => query), range: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    then: <T>(resolve: (value: typeof result) => T | PromiseLike<T>) => Promise.resolve(result).then(resolve),
  }
  const remove = vi.fn(async (_paths: string[]) => ({ error: null as unknown }))
  const rpc = vi.fn()
  const from = vi.fn(() => query)
  requireSupabase.mockReturnValue({ from, rpc, storage: { from: vi.fn(() => ({ remove })) } })
  return { query, remove, rpc, from }
}

describe('Supabase recycle-bin client protocol', () => {
  beforeEach(() => requireSupabase.mockReset())

  it('archives memory via DELETE without deleting photo bytes', async () => {
    const { from, query, remove } = clientFor()
    await removeCloudMemory('space', { id: 'memory' } as MemoryEntry)
    expect(from).toHaveBeenCalledExactlyOnceWith('memories')
    expect(query.eq.mock.calls).toEqual([['id', 'memory'], ['couple_id', 'space']])
    expect(remove).not.toHaveBeenCalled()
  })

  it('retains the prepared record on storage failure and finishes only after a successful retry', async () => {
    const { rpc, remove } = clientFor()
    rpc.mockResolvedValue({ data: ['space/photo.jpg'], error: null })
    remove.mockResolvedValueOnce({ error: new Error('storage unavailable') }).mockResolvedValue({ error: null })
    await expect(purgeCloudTrash('space', 'trash')).rejects.toThrow('请重试')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('prepare_trash_purge', { p_couple_id: 'space', p_id: 'trash' })
    await expect(purgeCloudTrash('space', 'trash')).resolves.toBeUndefined()
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_trash_purge', 'prepare_trash_purge', 'finish_trash_purge'])
    expect(remove).toHaveBeenCalledWith(['space/photo.jpg'])
  })

  it('fails closed on files outside the current couple and does not finish deletion', async () => {
    const { rpc, remove } = clientFor()
    rpc.mockResolvedValue({ data: ['other/photo.jpg'], error: null })
    await expect(purgeCloudTrash('space', 'trash')).rejects.toThrow('已停止删除')
    expect(remove).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('uses the scoped restore RPC and reports expired or conflicting records clearly', async () => {
    const { rpc } = clientFor()
    rpc.mockResolvedValue({ error: { message: 'TRASH_EXPIRED' } })
    await expect(restoreCloudTrash('space', 'trash')).rejects.toThrow('超过 30 天')
    expect(rpc).toHaveBeenCalledWith('restore_trash_entry', { p_couple_id: 'space', p_id: 'trash' })
    rpc.mockResolvedValue({ error: { message: 'RESTORE_CONFLICT' } })
    await expect(restoreCloudTrash('space', 'trash')).rejects.toThrow('保留当前内容')
  })

  it('lists only scoped metadata and removes expired entries after collecting pages', async () => {
    const visible = { id: 'one', kind: 'partner_note', original_id: 'note', title: 'note', deleted_at: '2026-10-01', expires_at: '2099-01-01' }
    const expired = { ...visible, id: 'expired', expires_at: '2000-01-01' }
    const { query, rpc } = clientFor([visible, expired])
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(listCloudTrash('space')).resolves.toEqual([{ id: 'one', kind: 'partner_note', originalId: 'note', title: 'note', deletedAt: '2026-10-01', expiresAt: '2099-01-01' }])
    expect(query.select).toHaveBeenCalledWith('id,kind,original_id,title,deleted_at,expires_at')
    expect(query.eq).toHaveBeenCalledWith('couple_id', 'space')
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_trash_purge', 'finish_trash_purge'])
  })

  it('sends caller-generated message IDs to the idempotent RPC without accepting a client author', async () => {
    const { rpc, from } = clientFor()
    rpc.mockResolvedValue({ data: null, error: null })
    const message = { id: 'request-id', text: ' hello ', revealAt: null, createdAt: '2020-01-01' }
    await createCloudMessage('space', 'forged-author', message)
    expect(rpc).toHaveBeenCalledWith('create_message_once', { p_couple_id: 'space', p_id: 'request-id', p_text: 'hello', p_reveal_at: null })
    expect(from).not.toHaveBeenCalled()
  })
})
