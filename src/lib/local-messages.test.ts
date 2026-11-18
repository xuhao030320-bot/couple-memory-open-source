import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageItem, MessageReply } from '../types'
import { getInitialMessages, updateLocalMessages } from './local-messages'
import { saveMessages } from './storage'

function message(id: string, createdAt = '2026-10-02T00:00:00.000Z'): MessageItem {
  return { id, text: `留言 ${id}`, revealAt: null, createdAt }
}

describe('local message cache', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('restores cached messages and replies on each local startup', () => {
    const reply: MessageReply = {
      id: 'reply', createdBy: '', text: '收到啦', createdAt: '2026-10-02T01:00:00.000Z',
    }
    const cached = { ...message('old'), revealAt: '2026-10-03T00:00:00.000Z', replies: [reply] }
    saveMessages([cached])

    expect(getInitialMessages(false)).toEqual([cached])
    expect(getInitialMessages(false)).toEqual([cached])
  })

  it('keeps previous messages when adding after a reload', () => {
    const old = message('old', '2026-10-01T00:00:00.000Z')
    const added = message('new')
    saveMessages([old])

    expect(getInitialMessages(false)).toEqual([old])
    expect(updateLocalMessages((current) => [...current, added])).toEqual([old, added])
    expect(getInitialMessages(false)).toEqual([added, old])
  })

  it('preserves consecutive additions even before the UI renders the first update', () => {
    const old = message('old')
    const first = message('first')
    const second = message('second')
    saveMessages([old])
    getInitialMessages(false)

    updateLocalMessages((current) => [...current, first])
    const next = updateLocalMessages((current) => [...current, second])

    expect(next).toEqual([old, first, second])
    expect(getInitialMessages(false)).toEqual([old, first, second])
  })

  it('preserves other cached messages and existing replies when replying and deleting', () => {
    const existingReply: MessageReply = {
      id: 'first-reply', createdBy: '', text: '第一条回复', createdAt: '2026-10-02T01:00:00.000Z',
    }
    const newReply: MessageReply = {
      id: 'second-reply', createdBy: '', text: '第二条回复', createdAt: '2026-10-02T02:00:00.000Z',
    }
    const old = { ...message('old'), replies: [existingReply] }
    const other = message('other')
    const added = message('new')
    saveMessages([old, other])
    getInitialMessages(false)

    updateLocalMessages((current) => [...current, added])
    updateLocalMessages((current) => current.map((item) => item.id === old.id
      ? { ...item, replies: [...(item.replies || []), newReply] }
      : item))
    expect(getInitialMessages(false)).toEqual([
      { ...old, replies: [existingReply, newReply] }, other, added,
    ])

    updateLocalMessages((current) => current.filter((item) => item.id !== other.id))
    expect(getInitialMessages(false)).toEqual([
      { ...old, replies: [existingReply, newReply] }, added,
    ])
  })

  it('starts cloud mode with no messages and never reads local messages', () => {
    saveMessages([message('local-only')])
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('Cloud mode must not read local messages')
    })

    expect(getInitialMessages(true)).toEqual([])
    expect(localStorage.getItem).not.toHaveBeenCalled()
  })
})
