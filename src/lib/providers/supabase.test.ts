import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToCloudWorkspace, unsubscribeCloudWorkspace } from './supabase'

const { requireSupabase } = vi.hoisted(() => ({ requireSupabase: vi.fn() }))

vi.mock('../supabase', () => ({ requireSupabase }))

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

interface ChangeFilter {
  event: ChangeEvent | '*'
  schema: string
  table: string
  filter?: string
}

interface ChangePayload {
  eventType: ChangeEvent
  new: Record<string, unknown>
  old: Record<string, unknown>
}

class MockChannel {
  listeners: Array<{ filter: ChangeFilter; callback: (payload: ChangePayload) => void }> = []
  subscribed = false

  on(_type: string, filter: ChangeFilter, callback: (payload: ChangePayload) => void) {
    this.listeners.push({ filter, callback })
    return this
  }

  subscribe() {
    if (this.subscribed) throw new Error('A channel can only be subscribed once')
    this.subscribed = true
    return this
  }

  emit(table: string, eventType: ChangeEvent, row: Record<string, unknown>) {
    const payload = {
      eventType,
      new: eventType === 'DELETE' ? {} : row,
      old: eventType === 'DELETE' ? row : {},
    }
    for (const { filter, callback } of this.listeners) {
      if (filter.schema !== 'public' || filter.table !== table) continue
      if (filter.event !== '*' && filter.event !== eventType) continue
      if (filter.filter) {
        const [column, expected] = filter.filter.split('=eq.')
        if (row[column] !== expected) continue
      }
      callback(payload)
    }
  }
}

describe('Supabase workspace subscription', () => {
  let channel: MockChannel
  const removeChannel = vi.fn()
  const coupleId = 'couple-current'

  beforeEach(() => {
    channel = new MockChannel()
    removeChannel.mockReset().mockResolvedValue('ok')
    requireSupabase.mockReturnValue({
      channel: vi.fn(() => channel),
      removeChannel,
    })
  })

  it('refreshes on couple notes inserts, updates and key-only deletes', () => {
    const onChange = vi.fn()
    subscribeToCloudWorkspace(coupleId, onChange)

    expect(channel.subscribed).toBe(true)
    channel.emit('couple_notes', 'INSERT', { couple_id: coupleId })
    channel.emit('couple_notes', 'UPDATE', { couple_id: coupleId })
    // Deletes use the primary key and act as workspace invalidation signals.
    channel.emit('couple_notes', 'DELETE', { couple_id: coupleId })

    expect(onChange).toHaveBeenCalledTimes(3)
    const deleteListener = channel.listeners.find(({ filter }) => filter.table === 'couple_notes' && filter.event === 'DELETE')
    expect(deleteListener?.filter).toEqual({ event: 'DELETE', schema: 'public', table: 'couple_notes' })
  })

  it('ignores another couple’s notes inserts and updates', () => {
    const onChange = vi.fn()
    subscribeToCloudWorkspace(coupleId, onChange)

    channel.emit('couple_notes', 'INSERT', { couple_id: 'couple-other' })
    channel.emit('couple_notes', 'UPDATE', { couple_id: 'couple-other' })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('refreshes on independent note changes and ignores other spaces insert/update', () => {
    const onChange = vi.fn()
    subscribeToCloudWorkspace(coupleId, onChange)
    channel.emit('partner_notes', 'INSERT', { id: 'a', couple_id: 'couple-other' })
    channel.emit('partner_notes', 'UPDATE', { id: 'a', couple_id: 'couple-other' })
    expect(onChange).not.toHaveBeenCalled()
    channel.emit('partner_notes', 'INSERT', { id: 'a', couple_id: coupleId })
    channel.emit('partner_notes', 'UPDATE', { id: 'a', couple_id: coupleId })
    channel.emit('partner_notes', 'DELETE', { id: 'a' })
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('removes the channel once and ignores notifications while removal is pending', () => {
    // Keep removal pending to exercise a callback already queued by the SDK.
    removeChannel.mockImplementation(() => new Promise(() => {}))
    const onChange = vi.fn()
    const handle = subscribeToCloudWorkspace(coupleId, onChange)

    unsubscribeCloudWorkspace(handle)
    handle.close()
    for (const { callback } of channel.listeners) {
      callback({ eventType: 'UPDATE', new: { couple_id: coupleId }, old: {} })
    }

    expect(removeChannel).toHaveBeenCalledExactlyOnceWith(channel)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts a new subscription while the previous channel for the same couple is still closing', () => {
    const channels = new Map<string, MockChannel>()
    removeChannel.mockImplementation(() => new Promise(() => {}))
    requireSupabase.mockReturnValue({
      // The SDK returns an existing channel for an existing name until removal finishes.
      channel: (name: string) => {
        if (!channels.has(name)) channels.set(name, new MockChannel())
        return channels.get(name)
      },
      removeChannel,
    })
    const previousOnChange = vi.fn()
    const nextOnChange = vi.fn()
    const previous = subscribeToCloudWorkspace(coupleId, previousOnChange)
    previous.close()
    const next = subscribeToCloudWorkspace(coupleId, nextOnChange)

    expect(channels.size).toBe(2)
    const [previousChannel, nextChannel] = [...channels.values()]
    previousChannel.emit('couple_notes', 'UPDATE', { couple_id: coupleId })
    nextChannel.emit('couple_notes', 'UPDATE', { couple_id: coupleId })
    expect(previousOnChange).not.toHaveBeenCalled()
    expect(nextOnChange).toHaveBeenCalledOnce()

    next.close()
    expect(removeChannel.mock.calls).toEqual([[previousChannel], [nextChannel]])
  })
})
