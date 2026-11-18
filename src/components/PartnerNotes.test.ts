import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writePartnerNotesDraft } from '../features/messages/partner-notes'
import { PartnerNotes } from './PartnerNotes'
import type { PartnerNote } from '../types'

afterEach(() => vi.unstubAllGlobals())

function browserStorage() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  vi.stubGlobal('window', { localStorage: storage })
  return storage
}

function renderNotes(notes: PartnerNote[], scope = 'local:local:', myUserId?: string) {
  return renderToStaticMarkup(createElement(PartnerNotes, {
    notes, scope, myUserId, onCreate: async () => {}, onUpdate: async () => {}, onDelete: async () => {}, onTogglePin: async () => {},
  }))
}

const published: PartnerNote = {
  id: 'published', text: '喜欢草莓蛋糕\n下次见面一起吃。', kind: 'like', createdAt: '2026-10-02T08:30:00.000Z', createdBy: 'partner',
}

describe('individually published partner notes', () => {
  it('starts with a collapsed editor and limits a large list to twenty entries', () => {
    browserStorage()
    const notes = Array.from({ length: 23 }, (_, index) => ({ ...published, id: `entry-${index}`, text: `entry ${index}` }))
    const html = renderNotes(notes)
    expect(html).toContain('partner-notes-compose-shell" hidden=""')
    expect(html).toContain('写一条备忘')
    expect(html.match(/<article/g)).toHaveLength(20)
    expect(html).toContain('再看 3 条')
    expect(html).toContain('还有 3 条')
  })

  it('shows pinned entries before newer entries, preserving absolute publication time', () => {
    browserStorage()
    const html = renderNotes([
      { ...published, id: 'new', text: '新条目', createdAt: '2026-10-19T08:30:00.000Z' },
      { ...published, id: 'pin', text: '置顶的旧条目', pinned: true },
    ])
    expect(html.indexOf('置顶的旧条目')).toBeLessThan(html.indexOf('新条目'))
    expect(html).toContain('置顶 · 2026年10月02日')
    expect(html).toContain('dateTime="2026-10-02T08:30:00.000Z"')
    expect(html).toContain('取消置顶')
  })

  it('keeps multiline content in one article and displays the recorded publication time', () => {
    browserStorage()
    const html = renderNotes([published], 'local:local:', 'me')

    expect(html.match(/<article/g)).toHaveLength(1)
    expect(html).toContain('喜欢草莓蛋糕\n下次见面一起吃。')
    expect(html).toContain('dateTime="2026-10-02T08:30:00.000Z"')
    expect(html).toContain('2026年10月02日')
    expect(html).toContain('对方')
    expect(html).toContain('>编辑</button>')
    expect(html).toContain('>删除</button>')
    expect(html.match(/<textarea/g)).toHaveLength(1)
    expect(html).toContain('maxLength="1000"')
    expect(html).toContain('rows="4"')
    expect(html).not.toContain('<li>')
  })

  it('orders new entries first and never invents a timestamp for migrated content', () => {
    browserStorage()
    const notes: PartnerNote[] = [
      { id: 'legacy', text: '历史原文', kind: 'care', createdAt: null, legacy: true },
      { ...published, id: 'older', text: '较早发布', createdAt: '2026-10-01T08:30:00Z' },
      { ...published, text: '最新发布' },
    ]
    const html = renderNotes(notes)
    expect(html.indexOf('最新发布')).toBeLessThan(html.indexOf('较早发布'))
    expect(html.indexOf('较早发布')).toBeLessThan(html.indexOf('历史原文'))
    expect(html).toContain('历史备忘 · 原发布时间未记录')
    expect(html.match(/<time /g)).toHaveLength(2)
  })

  it('offers one-entry publishing and guidance when there are no notes', () => {
    browserStorage()
    const html = renderNotes([])
    expect(html).toContain('还没有备忘')
    expect(html).toContain('发布第一条吧')
    expect(html).toContain('发布备忘')
    expect(html).toContain('每次发布是一条备忘')
    expect(html.match(/<textarea/g)).toHaveLength(1)
    expect(html).not.toContain('<article')
  })

  it('restores the correct edit without replacing its text with refreshed server content', () => {
    const storage = browserStorage()
    writePartnerNotesDraft('cloudbase:space:me', {
      editingId: published.id,
      baseline: { text: published.text, kind: published.kind },
      input: { text: '我还没保存的修改', kind: 'care' },
    }, storage)
    const html = renderNotes([{ ...published, text: '对方的最新正式内容' }], 'cloudbase:space:me')
    expect(html).toContain('我还没保存的修改')
    expect(html).toContain('对方的最新正式内容')
    expect(html).toContain('已恢复上次未保存的修改')
    expect(html).not.toContain('partner-notes-compose-shell" hidden=""')
    expect(html).toContain('这条备忘有新的修改，你输入的内容已保留')
    expect(html).toContain('保存修改')
  })

  it('recovers text as a new publication when its edited entry has been deleted', () => {
    const storage = browserStorage()
    writePartnerNotesDraft('local:local:', {
      editingId: 'removed', baseline: { text: '原文', kind: 'like' }, input: { text: '还想保留的正文', kind: 'care' },
    }, storage)
    const html = renderNotes([])
    expect(html).toContain('还想保留的正文')
    expect(html).toContain('已恢复上次未发布的备忘')
    expect(html).toContain('发布备忘')
    expect(html).not.toContain('保存修改')
  })

  it('does not expose another account draft', () => {
    const storage = browserStorage()
    writePartnerNotesDraft('cloudbase:space:user-a', {
      editingId: null, baseline: { text: '', kind: 'like' }, input: { text: '账号 A 私有草稿', kind: 'like' },
    }, storage)
    const html = renderNotes([published], 'cloudbase:space:user-b')
    expect(html).not.toContain('账号 A 私有草稿')
    expect(html).not.toContain('已恢复上次')
    expect(html).toContain('喜欢草莓蛋糕')
  })

  it('keeps an overlength legacy draft intact and asks for an explicit shorter publication', () => {
    browserStorage()
    const legacyText = '旧草稿'.repeat(400)
    window.localStorage.setItem('only-us-partner-notes-draft:local%3Alocal%3A', JSON.stringify({
      baseline: { likes: '', dislikes: '' }, draft: { likes: legacyText, dislikes: '也要保留的留意内容' },
    }))
    const html = renderNotes([])
    expect(html).toContain(legacyText)
    expect(html).toContain('也要保留的留意内容')
    expect(html).toContain('这条备忘超过 1000 字，请缩短后发布。原内容已保留。')
    expect(html).toMatch(/type="submit" disabled=""/)
  })
})
