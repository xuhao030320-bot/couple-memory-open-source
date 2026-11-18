import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/lib/zip-core-custom.js'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceBackup, type BackupSnapshot } from './workspace-backup'

function snapshot(): BackupSnapshot {
  return {
    provider: 'local', scope: 'local', profile: { personA: '<script>bad()</script>', personB: 'B', startDate: '2024-01-01' },
    memories: [{ id: 'm', title: '海边', displayText: '我们的回忆', originalText: '原来的文字', date: '2026-10-19', location: '', category: 'travel', moodEmoji: '', moodText: '', style: 'cream', template: 'hero-note', tags: [], createdAt: '2026-10-19T01:00:00Z', photos: [
      { id: 'p', src: 'blob:obsolete', name: '../../照片#100%.heic', alt: '风景', caption: '说明', order: 0, role: 'cover', focusX: .5, focusY: .5, kind: 'image', mimeType: 'image/jpeg', blob: new Blob(['actual media bytes'], { type: 'image/jpeg' }) },
    ] }],
    wishes: [{ id: 'w', text: '一起看海', category: 'daily', completed: true, createdAt: '2026-10-01' }],
    anniversaries: [{ id: 'a', title: '旅行', date: '2026-10-19', kind: 'trip', note: '一起', repeatsYearly: true, createdAt: '2026-10-01' }],
    messages: [{ id: 'msg', text: '今晚见', revealAt: null, createdAt: '2026-10-19', replies: [{ id: 'r', text: '好', createdBy: 'partner', createdAt: '2026-10-19' }] }],
    partnerNotes: [{ id: 'n', text: '喜欢草莓', kind: 'like', pinned: true, createdAt: '2026-10-19T02:00:00Z', createdBy: 'partner' }],
  }
}

describe('complete portable workspace archive', () => {
  it('creates a readable ZIP with actual media and all record kinds, not expiring URLs', async () => {
    const source = snapshot()
    const blob = await createWorkspaceBackup(source)
    expect(blob).toBeInstanceOf(Blob)
    const reader = new ZipReader(new BlobReader(blob!), { useWebWorkers: false })
    const entries = (await reader.getEntries()).filter((entry) => !entry.directory)
    const manifest = entries.find((entry) => entry.filename === 'manifest.json')!
    const data = JSON.parse(await manifest.getData!(new TextWriter()))
    expect(data.format).toBe('only-ours-backup')
    expect(data.partnerNotes).toEqual(source.partnerNotes)
    expect(data.messages[0].replies).toEqual(source.messages[0].replies)
    expect(data.wishes).toEqual(source.wishes)
    expect(data.anniversaries).toEqual(source.anniversaries)
    expect(data.memories[0].originalText).toBe(source.memories[0].originalText)
    const photo = data.memories[0].photos[0]
    expect(photo.src).toMatch(/^media\/0001-1-/)
    expect(photo.src).not.toContain('..')
    expect(photo.src).toMatch(/\.jpg$/)
    expect(photo).not.toHaveProperty('blob')
    expect(photo).not.toHaveProperty('storagePath')
    const media = await entries.find((entry) => entry.filename === photo.src)!.getData!(new Uint8ArrayWriter())
    expect(new TextDecoder().decode(media)).toBe('actual media bytes')
    const html = await entries.find((entry) => entry.filename === 'index.html')!.getData!(new TextWriter())
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('喜欢草莓')
    expect(html).not.toContain('blob:obsolete')
    expect(html).toContain(photo.src.split('/').map(encodeURIComponent).join('/'))
    expect(html).toContain('%23100%25')
    await reader.close()
  })
  it('fails the entire export if one photo cannot be copied', async () => {
    const fetchMedia = vi.fn().mockRejectedValue(new Error('private media unavailable'))
    await expect(createWorkspaceBackup(snapshot(), { fetchMedia })).rejects.toThrow('private media unavailable')
  })
  it('rejects authentication HTML returned instead of the actual photo', async () => {
    const source = snapshot()
    source.memories[0].photos[0].blob = undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))
    try { await expect(createWorkspaceBackup(source)).rejects.toThrow('未返回媒体文件') }
    finally { fetchMock.mockRestore() }
  })
  it('aborts before writing media if the exporting account has changed', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMedia = vi.fn()
    await expect(createWorkspaceBackup(snapshot(), { signal: controller.signal, fetchMedia })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMedia).not.toHaveBeenCalled()
  })
  it('also creates an archive for a space with no photos', async () => {
    const source = snapshot()
    source.memories = []
    const onProgress = vi.fn()
    const zip = await createWorkspaceBackup(source, { onProgress })
    expect(zip!.size).toBeGreaterThan(0)
    expect(onProgress).toHaveBeenCalledWith(0, 0)
  })
})
