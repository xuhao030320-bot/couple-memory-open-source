import { describe, expect, it } from 'vitest'
import {
  changeMessageDraft, changeReplyDraft, createMessageDraftStore, emptyMessageDraft, emptyReplyDraft,
  messageDraftKey, prepareMessageAttempt, prepareReplyAttempt, revealTimeStatus, runDraftSubmission,
} from './message-drafts'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const now = new Date('2026-10-19T14:00:00')

describe('message and per-thread drafts', () => {
  it('restores message text, reveal choice and local time in the exact account/workspace', () => {
    const store = createMessageDraftStore(memoryStorage())
    const draft = changeMessageDraft(emptyMessageDraft(), { text: '没发送的话', revealPreset: 'custom', customTime: '2026-10-20T08:30' })
    store.writeMessage('cloud:space-a:user-a', draft)
    expect(store.readMessage('cloud:space-a:user-a')).toEqual(draft)
    expect(store.readMessage('cloud:space-b:user-a')).toBe(null)
    expect(store.readMessage('cloud:space-a:user-b')).toBe(null)
  })

  it('persists the last input synchronously, so a fast remount requires no timeout or cleanup to recover it', () => {
    const storage = memoryStorage()
    const first = createMessageDraftStore(storage)
    const typed = changeMessageDraft(emptyMessageDraft(), { text: '刚输入的最后一字' })
    first.writeMessage('local:local:', typed)
    expect(createMessageDraftStore(storage).readMessage('local:local:')?.text).toBe('刚输入的最后一字')
  })

  it('keeps different reply threads separate, even when one thread is closed or another is opened', () => {
    const store = createMessageDraftStore(memoryStorage())
    const a = changeReplyDraft(emptyReplyDraft(), '留言 A 的回复草稿')
    const b = changeReplyDraft(emptyReplyDraft(), '留言 B 的回复草稿')
    store.writeReply('scope', 'a', a)
    store.writeReply('scope', 'b', b)
    expect(store.readReply('scope', 'a')?.text).toBe(a.text)
    expect(store.readReply('scope', 'b')?.text).toBe(b.text)
    expect(store.readReply('other-scope', 'a')).toBe(null)
  })

  it('reuses the same message id, createdAt and reveal timestamp after failure, navigation and reload', () => {
    const storage = memoryStorage()
    const store = createMessageDraftStore(storage)
    const draft = changeMessageDraft(emptyMessageDraft(), { text: '重试不能重复发布', revealPreset: 'tonight' })
    const first = prepareMessageAttempt(draft, now)
    store.writeMessage('scope', first)
    const reloaded = createMessageDraftStore(storage).readMessage('scope')!
    const retry = prepareMessageAttempt(reloaded, new Date(now.getTime() + 30_000))
    expect(retry.attempt.message).toEqual(first.attempt.message)
    expect(prepareMessageAttempt(changeMessageDraft(reloaded, { text: '这是另一条内容' }), now).attempt.message.id).not.toBe(first.attempt.message.id)
  })

  it('reuses a reply id for the same failed text but allocates a new id after the text changes', () => {
    const store = createMessageDraftStore(memoryStorage())
    const first = prepareReplyAttempt(changeReplyDraft(emptyReplyDraft(), '同一次回复'))
    store.writeReply('scope', 'thread', first)
    expect(prepareReplyAttempt(store.readReply('scope', 'thread')!).attempt.id).toBe(first.attempt.id)
    expect(prepareReplyAttempt(changeReplyDraft(first, '新的回复')).attempt.id).not.toBe(first.attempt.id)
  })

  it('only clears a successfully sent snapshot, preserving a newer message and newer reply edit', () => {
    const store = createMessageDraftStore(memoryStorage())
    const sent = prepareMessageAttempt(changeMessageDraft(emptyMessageDraft(), { text: '正在发送' }), now)
    const newer = changeMessageDraft(sent, { text: '后来写的新内容' })
    store.writeMessage('scope', sent)
    store.writeMessage('scope', newer, sent)
    expect(store.clearMessage('scope', sent)).toBe(false)
    expect(store.readMessage('scope')?.text).toBe(newer.text)
    const reply = prepareReplyAttempt(changeReplyDraft(emptyReplyDraft(), '旧回复'))
    const newReply = changeReplyDraft(reply, '新回复')
    store.writeReply('scope', 'thread', reply)
    store.writeReply('scope', 'thread', newReply, reply)
    expect(store.clearReply('scope', 'thread', reply)).toBe(false)
    expect(store.clearReply('scope', 'thread', newReply)).toBe(true)
  })

  it('cleans drafts when the user erases the content without deleting another writer draft', () => {
    const store = createMessageDraftStore(memoryStorage())
    const old = changeMessageDraft(emptyMessageDraft(), { text: '旧稿' })
    const next = changeMessageDraft(old, { text: '' })
    store.writeMessage('scope', old)
    store.writeMessage('scope', next, old)
    expect(store.readMessage('scope')).toBe(null)
    const newer = changeMessageDraft(old, { text: '新页面的稿' })
    store.writeMessage('scope', newer)
    store.writeMessage('scope', next, old)
    expect(store.readMessage('scope')?.text).toBe('新页面的稿')
  })

  it('keeps the failed submission snapshot and releases its lock for retry', async () => {
    const store = createMessageDraftStore(memoryStorage())
    const draft = prepareMessageAttempt(changeMessageDraft(emptyMessageDraft(), { text: '失败仍保留' }), now)
    store.writeMessage('scope', draft)
    await expect(runDraftSubmission('failure', async () => { throw Error('offline') })).rejects.toThrow('offline')
    expect(store.readMessage('scope')?.attempt?.message.id).toBe(draft.attempt.message.id)
    await expect(runDraftSubmission('failure', async () => 'retried')).resolves.toBe('retried')
  })

  it('prevents an immediate double send and a remounted editor send while the old request is pending', async () => {
    let release!: () => void
    let calls = 0
    const first = runDraftSubmission('same-scope-message', () => { calls++; return new Promise<void>((resolve) => { release = resolve }) })
    await expect(runDraftSubmission('same-scope-message', async () => { calls++ })).rejects.toThrow('还在发送')
    expect(calls).toBe(1)
    release()
    await first
  })

  it('ignores corrupted drafts and allows input when local storage fails', () => {
    const storage = memoryStorage()
    storage.setItem(messageDraftKey('scope'), '{bad json')
    const store = createMessageDraftStore(storage)
    expect(store.readMessage('scope')).toBe(null)
    const failed = createMessageDraftStore({ getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') }, removeItem: () => { throw Error('denied') } })
    expect(failed.readMessage('scope')).toBe(null)
    expect(failed.writeMessage('scope', changeMessageDraft(emptyMessageDraft(), { text: '仍可输入' }))).toBe(false)
  })
})

describe('strict reveal time and exact date summary', () => {
  it('rejects empty, invalid, normalized calendar dates, equal and past times', () => {
    for (const value of ['', 'not-a-date', '2027-02-30T08:00', '2026-10-19T14:00', '2020-01-01T08:00']) {
      expect(revealTimeStatus('custom', value, now).error).not.toBe('')
    }
  })

  it('accepts a strictly future local date and prints its full actual date and time', () => {
    const result = revealTimeStatus('custom', '2026-10-20T08:30', now)
    expect(result.error).toBe('')
    expect(result.revealAt).toBe(new Date('2026-10-20T08:30').toISOString())
    expect(result.summary).toBe('2026年10月20日 08:30，对方可见。')
  })

  it('revalidates when sending, after a previously valid scheduled time has expired', () => {
    const draft = changeMessageDraft(emptyMessageDraft(), { text: '定时', revealPreset: 'custom', customTime: '2026-10-19T14:01' })
    expect(revealTimeStatus('custom', draft.customTime, now).error).toBe('')
    expect(() => prepareMessageAttempt(draft, new Date('2026-10-19T14:01:00'))).toThrow('晚于当前')
  })

  it('does not silently move a failed tonight submission to another day or send its expired timestamp', () => {
    const first = prepareMessageAttempt(changeMessageDraft(emptyMessageDraft(), { text: '同次定时请求', revealPreset: 'tonight' }), now)
    expect(() => prepareMessageAttempt(first, new Date('2026-10-20T00:01:00'))).toThrow('原定的可见时间已过')
  })

  it('makes tonight next midnight and tomorrow morning explicit rather than ambiguous', () => {
    expect(revealTimeStatus('tonight', '', now).summary).toBe('2026年10月20日 00:00，对方可见。')
    expect(revealTimeStatus('tomorrow', '', now).summary).toBe('2026年10月20日 08:00，对方可见。')
    expect(revealTimeStatus('immediate', '', now).revealAt).toBe(null)
  })
})
