import { describe, expect, it, vi } from 'vitest'
import { commitWithBackgroundRefresh } from './committed-action'

describe('acknowledging committed actions', () => {
  it('confirms a committed write without waiting for a stalled refresh', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'saved-once' })
    const refresh = vi.fn(() => new Promise(() => {}))
    await expect(commitWithBackgroundRefresh(write, refresh)).resolves.toEqual({ id: 'saved-once' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('reports failed reconciliation separately, preserving successful submission', async () => {
    const problem = new Error('network offline')
    const onSyncError = vi.fn()
    await expect(commitWithBackgroundRefresh(async () => 'saved', async () => { throw problem }, onSyncError)).resolves.toBe('saved')
    await vi.waitFor(() => expect(onSyncError).toHaveBeenCalledWith(problem))
  })
  it('keeps a rejected write retryable and does not run reconciliation', async () => {
    const refresh = vi.fn()
    await expect(commitWithBackgroundRefresh(async () => { throw new Error('not committed') }, refresh)).rejects.toThrow('not committed')
    expect(refresh).not.toHaveBeenCalled()
  })
})
