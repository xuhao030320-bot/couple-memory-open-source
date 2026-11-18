import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createComposerInitialState, draftFingerprint } from '../features/memories/compose-state'
import { createComposerDraftStore, makeComposerDraft } from '../features/memories/compose-drafts'
import { changeMessageDraft, changeReplyDraft, createMessageDraftStore, emptyMessageDraft, emptyReplyDraft } from '../features/messages/message-drafts'
import type { MemoryEntry } from '../types'
import { ComposerView } from './ComposerView'
import { MessagesView } from './MessagesView'

vi.mock('../lib/amap', () => ({ reverseGeocode: async () => '', loadAMap: async () => null, isAMapConfigured: () => false, amapOpenUrl: () => '' }))

let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
beforeEach(() => {
  const values = new Map<string, string>()
  storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } }
  vi.stubGlobal('window', { localStorage: storage })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T14:00:00'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const saved: MemoryEntry = {
  id: 'saved-memory', title: '正式回忆', originalText: '正式原文', displayText: '正式原文', date: '2026-10-01', location: '',
  style: 'cream', template: 'hero-note', photos: [], tags: [], category: 'daily', moodEmoji: '', moodText: '', createdAt: '2026-10-01T08:00:00Z',
}
function renderComposer(scope: string, memory?: MemoryEntry) {
  return renderToStaticMarkup(createElement(ComposerView, { draftScope: scope, initialMemory: memory, onSave: async () => {} }))
}
function renderMessages(scope: string) {
  return renderToStaticMarkup(createElement(MessagesView, {
    messages: [{ id: 'thread', text: '正式留言', revealAt: null, createdAt: '2026-10-01T08:00:00Z' }], partnerName: '对方',
    notesScope: scope, partnerNotes: [], onSend: async () => {}, onDelete: async () => {}, onReply: async () => {},
    onCreateNote: async () => {}, onUpdateNote: async () => {}, onDeleteNote: async () => {}, onTogglePinNote: async () => {},
  }))
}

describe('draft-aware editor presentation', () => {
  it('starts empty without a restoration notice and offers optional advanced fields and preview', () => {
    const html = renderComposer('local:local:')
    expect(html).not.toContain('已恢复上次未完成')
    expect(html).toContain('<details class="composer-advanced">')
    expect(html).toContain('<details class="composer-preview">')
    expect(html).toContain('composer-save-bar')
    expect(html.indexOf('想说的话')).toBeLessThan(html.indexOf('完善这篇回忆'))
    expect(storage.getItem('only-us-compose-draft')).toBe(null)
  })

  it('never renders an ownerless legacy draft inside a cloud account', () => {
    storage.setItem('only-us-compose-draft', JSON.stringify({ ...createComposerInitialState(null, null).fields, title: '旧浏览器私有草稿', text: '不能串给云端账号' }))
    const html = renderComposer('cloudbase:space:user')
    expect(html).not.toContain('旧浏览器私有草稿')
    expect(html).not.toContain('不能串给云端账号')
    expect(html).not.toContain('已恢复上次未完成')
  })

  it('restores an edited memory only from its scoped memory id rather than the new-entry draft', async () => {
    const store = createComposerDraftStore(storage)
    const base = createComposerInitialState(saved, null).fields
    const edit = makeComposerDraft('cloudbase:space:user', saved.id, { ...base, title: '这条旧回忆的编辑稿', text: '还没保存的编辑正文' }, draftFingerprint(base), { memoryId: saved.id, createdAt: saved.createdAt })
    await store.persist(edit)
    const newBase = createComposerInitialState(null, null).fields
    await store.persist(makeComposerDraft(edit.scope, null, { ...newBase, title: '另外一条新增稿' }, draftFingerprint(newBase), { memoryId: 'new-id', createdAt: '' }))
    const html = renderComposer(edit.scope, saved)
    expect(html).toContain('这条旧回忆的编辑稿')
    expect(html).toContain('还没保存的编辑正文')
    expect(html).not.toContain('另外一条新增稿')
    expect(html).toContain('已恢复上次未完成')
    expect(renderComposer('cloudbase:space:other-user', saved)).toContain('正式原文')
  })

  it('restores message and per-thread reply inputs when returning to their own scope', () => {
    const store = createMessageDraftStore(storage)
    store.writeMessage('cloudbase:space:user', changeMessageDraft(emptyMessageDraft(), { text: '页面外返回的留言', revealPreset: 'custom', customTime: '2026-10-20T08:30' }))
    store.writeReply('cloudbase:space:user', 'thread', changeReplyDraft(emptyReplyDraft(), '这条线程的回复草稿'))
    const html = renderMessages('cloudbase:space:user')
    expect(html).toContain('页面外返回的留言')
    expect(html).toContain('这条线程的回复草稿')
    expect(html).toContain('2026年10月20日 08:30，对方可见。')
    const other = renderMessages('cloudbase:space:other-user')
    expect(other).not.toContain('页面外返回的留言')
    expect(other).not.toContain('这条线程的回复草稿')
  })

  it('keeps a restored past time visible with an inline explanation and disabled send action', () => {
    const store = createMessageDraftStore(storage)
    store.writeMessage('local:local:', changeMessageDraft(emptyMessageDraft(), { text: '保留输入别误发', revealPreset: 'custom', customTime: '2020-01-01T08:00' }))
    const html = renderMessages('local:local:')
    expect(html).toContain('保留输入别误发')
    expect(html).toContain('过去的时间不能用于定时留言')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toMatch(/disabled=""[^>]*><svg[^]*?留在这里/)
  })
})
