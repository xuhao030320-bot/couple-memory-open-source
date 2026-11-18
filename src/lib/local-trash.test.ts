import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listLocalTrash, moveLocalToTrash, purgeLocalTrash, restoreLocalTrash } from './local-trash'
import { getLocalPartnerNotes, updateLocalPartnerNotes } from './partner-notes-data'
import { getMemories } from './storage'
import type { MemoryEntry, PartnerNote } from '../types'

beforeEach(() => {
  const values = new Map<string, string>([['only-us-demo-seeded', 'true']])
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const note: PartnerNote = { id: 'original', text: '草莓蛋糕', kind: 'like', createdAt: '2026-01-01T00:00:00Z', pinned: true }

describe('local recovery of deleted entries', () => {
  it('restores notes with original identity, publication date and pinned state', async () => {
    await moveLocalToTrash('local', 'partner_note', note)
    const [item] = await listLocalTrash()
    expect(item.originalId).toBe(note.id)
    expect('payload' in item).toBe(false)
    await restoreLocalTrash('local', item.id)
    expect(getLocalPartnerNotes()).toEqual([note])
    expect(await listLocalTrash()).toEqual([])
  })
  it('keeps actual video bytes available after restoring a memory', async () => {
    const blob = new Blob(['actual video bytes'], { type: 'video/mp4' })
    const memory: MemoryEntry = {
      id: 'memory', title: '小旅行', originalText: '一起出发', displayText: '一起出发', date: '2026-10-19',
      location: '', style: 'cream', template: 'hero-note', tags: [], category: 'travel', moodEmoji: '', moodText: '', createdAt: note.createdAt!,
      photos: [{ id: 'video', name: 'video.mp4', alt: '', caption: '', order: 0, role: 'cover', focusX: .5, focusY: .5, kind: 'video', mimeType: 'video/mp4', src: 'blob:expired-preview', blob }],
    }
    await moveLocalToTrash('local', 'memory', memory)
    await restoreLocalTrash('local', (await listLocalTrash())[0].id)
    const [restored] = await getMemories()
    expect(await restored.photos[0].blob!.text()).toBe('actual video bytes')
    expect(restored.id).toBe(memory.id)
  })
  it('never replaces a newer active entry when the original id already exists', async () => {
    await moveLocalToTrash('local', 'partner_note', note)
    updateLocalPartnerNotes('local', () => [{ ...note, text: 'newer active version' }])
    await expect(restoreLocalTrash('local', (await listLocalTrash())[0].id)).rejects.toThrow('未覆盖')
    expect(getLocalPartnerNotes()[0].text).toBe('newer active version')
    expect(await listLocalTrash()).toHaveLength(1)
  })
  it('expires recovery after thirty days and removes expired entries on list', async () => {
    const now = Date.now()
    await moveLocalToTrash('local', 'partner_note', note)
    const [item] = await listLocalTrash()
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 86400000)
    await expect(restoreLocalTrash('local', item.id)).rejects.toThrow('超过 30 天')
    expect(await listLocalTrash()).toEqual([])
  })
  it('purges only the specified local entry and rejects other scopes', async () => {
    await moveLocalToTrash('local', 'partner_note', note)
    const [item] = await listLocalTrash()
    await expect(purgeLocalTrash('another-space', item.id)).rejects.toThrow('其他空间')
    await purgeLocalTrash('local', item.id)
    expect(await listLocalTrash()).toEqual([])
    expect(getLocalPartnerNotes()).toEqual([])
  })
})
