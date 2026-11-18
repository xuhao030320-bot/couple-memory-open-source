import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createComposerInitialState, draftFingerprint } from './compose-state'
import { composerDraftKey, createComposerDraftStore, createIndexedDraftMediaStore, makeComposerDraft, type DraftMediaStore } from './compose-drafts'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
function baseline() { return createComposerInitialState(null, null, false, '2026-10-19').fields }
function record(scope = 'local:local:', target: string | null = null, withMedia = false) {
  const base = baseline()
  const fields = { ...base, text: '最后一字也要保留', photos: withMedia ? [{
    id: 'photo', src: 'data:image/png;base64,aGVsbG8=', name: 'picture.png', alt: '照片', caption: '', order: 0,
    role: 'cover' as const, focusX: 0.5, focusY: 0.5, kind: 'image' as const, mimeType: 'image/png',
  }] : [] }
  return makeComposerDraft(scope, target, fields, draftFingerprint(base), { memoryId: target ?? 'stable-new-memory', createdAt: '', layoutReady: false })
}

describe('scoped composer draft durability', () => {
  it('keeps accounts, workspaces, new drafts and individual edited memories separate', async () => {
    const store = createComposerDraftStore(memoryStorage(), createIndexedDraftMediaStore(new IDBFactory()))
    for (const draft of [record('cloud:couple-a:user-a'), record('cloud:couple-b:user-a'), record('cloud:couple-a:user-b'), record('cloud:couple-a:user-a', 'memory-a'), record('cloud:couple-a:user-a', 'memory-b')]) await store.persist(draft)
    expect(store.read('cloud:couple-a:user-a')?.target).toBe(null)
    expect(store.read('cloud:couple-a:user-a', 'memory-a')?.memoryId).toBe('memory-a')
    expect(store.read('cloud:couple-a:user-a', 'memory-b')?.memoryId).toBe('memory-b')
    expect(store.read('cloud:couple-a:user-c', null)).toBe(null)
  })

  it('writes the last text synchronously before a fast navigation without waiting for a debounce', async () => {
    const storage = memoryStorage()
    const store = createComposerDraftStore(storage)
    const draft = record()
    const pending = store.persist(draft)
    const immediatelyRemounted = createComposerDraftStore(storage)
    expect(immediatelyRemounted.read(draft.scope, null)?.fields.text).toBe('最后一字也要保留')
    await pending
  })

  it('does not create an empty draft or remove another writer draft when given a clean snapshot', async () => {
    const store = createComposerDraftStore(memoryStorage())
    const clean = makeComposerDraft('local:local:', null, baseline(), draftFingerprint(baseline()), { memoryId: 'id', createdAt: '' })
    await store.persist(clean)
    expect(store.read(clean.scope, null)).toBe(null)
    const other = record()
    await store.persist(other)
    await store.persist(clean)
    expect(store.read(other.scope, null)?.snapshotId).toBe(other.snapshotId)
  })

  it('preserves both image data and video Blobs in real IndexedDB without putting media bytes in localStorage', async () => {
    const storage = memoryStorage()
    const factory = new IDBFactory()
    const store = createComposerDraftStore(storage, createIndexedDraftMediaStore(factory))
    const draft = record('local:local:', null, true)
    draft.fields.photos.push({ ...draft.fields.photos[0], id: 'video', kind: 'video', name: 'clip.mp4', mimeType: 'video/mp4', src: 'blob:old-runtime', blob: new Blob(['video-bytes'], { type: 'video/mp4' }) })
    await store.persist(draft)
    const manifest = storage.getItem(composerDraftKey(draft.scope, null))!
    expect(manifest).not.toContain('aGVsbG8=')
    expect(manifest).not.toContain('blob:old-runtime')
    const reopened = createComposerDraftStore(storage, createIndexedDraftMediaStore(factory))
    const restored = await reopened.restore(reopened.read(draft.scope, null)!)
    expect(await restored.photos[0].blob?.text()).toBe('hello')
    expect(await restored.photos[1].blob?.text()).toBe('video-bytes')
    expect(restored.photos.every((photo) => photo.src.startsWith('blob:'))).toBe(true)
  })

  it('marks media pending and makes a fast remount wait until the exact media transaction commits', async () => {
    const storage = memoryStorage()
    const idb = createIndexedDraftMediaStore(new IDBFactory())
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const media: DraftMediaStore = { ...idb, put: async (key, photos) => { await gate; await idb.put(key, photos) } }
    const store = createComposerDraftStore(storage, media)
    const draft = record('local:local:', null, true)
    const saving = store.persist(draft)
    expect(store.hasPendingMedia()).toBe(true)
    const snapshot = store.read(draft.scope, null)!
    expect(snapshot.mediaReady).toBe(false)
    let recovered = false
    const restoring = store.restore(snapshot).then((fields) => { recovered = true; return fields })
    await Promise.resolve()
    expect(recovered).toBe(false)
    release()
    await saving
    expect((await restoring).photos[0].blob).toBeInstanceOf(Blob)
    expect(store.read(draft.scope, null)?.mediaReady).toBe(true)
  })

  it('flushing a manifest from a fresh editor never replaces its IndexedDB Blobs with empty descriptors', async () => {
    const storage = memoryStorage()
    const factory = new IDBFactory()
    const first = createComposerDraftStore(storage, createIndexedDraftMediaStore(factory))
    const draft = record('local:local:', null, true)
    await first.persist(draft)
    const reopened = createComposerDraftStore(storage, createIndexedDraftMediaStore(factory))
    const manifest = reopened.read(draft.scope, null)!
    expect(manifest.fields.photos[0].blob).toBeUndefined()
    expect(manifest.fields.photos[0].src).toBe('')
    await reopened.persist(manifest)
    expect(await (await reopened.restore(manifest)).photos[0].blob?.text()).toBe('hello')
  })

  it('does not let an older media completion overwrite a newer text snapshot', async () => {
    const storage = memoryStorage()
    const idb = createIndexedDraftMediaStore(new IDBFactory())
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const store = createComposerDraftStore(storage, { ...idb, put: async (key, photos) => { await gate; await idb.put(key, photos) } })
    const first = record('local:local:', null, true)
    const firstSaving = store.persist(first)
    const second = makeComposerDraft(first.scope, null, { ...first.fields, text: '新页面继续输入' }, first.baselineFingerprint, first, first)
    const secondSaving = store.persist(second)
    release()
    await Promise.all([firstSaving, secondSaving])
    expect(store.read(first.scope, null)?.fields.text).toBe('新页面继续输入')
    expect(store.read(first.scope, null)?.snapshotId).toBe(second.snapshotId)
  })

  it('a late successful publication only clears its own snapshot, retaining newer edits and their media', async () => {
    const store = createComposerDraftStore(memoryStorage(), createIndexedDraftMediaStore(new IDBFactory()))
    const old = record('local:local:', null, true)
    await store.persist(old)
    const newer = makeComposerDraft(old.scope, null, { ...old.fields, text: '请求未返回时的新草稿' }, old.baselineFingerprint, old, old)
    await store.persist(newer)
    expect(await store.clearSnapshot(old)).toBe(false)
    expect((await store.restore(store.read(old.scope, null)!)).photos[0].blob).toBeInstanceOf(Blob)
    expect(await store.clearSnapshot(newer)).toBe(true)
    expect(store.read(old.scope, null)).toBe(null)
  })

  it('a failed media write keeps the text and pending manifest and supports retry', async () => {
    const idb = createIndexedDraftMediaStore(new IDBFactory())
    let fail = true
    const store = createComposerDraftStore(memoryStorage(), { ...idb, put: async (key, photos) => { if (fail) throw Error('quota'); await idb.put(key, photos) } })
    const draft = record('local:local:', null, true)
    await expect(store.persist(draft)).rejects.toThrow('quota')
    expect(store.read(draft.scope, null)?.fields.text).toBe(draft.fields.text)
    expect(store.read(draft.scope, null)?.mediaReady).toBe(false)
    fail = false
    await store.persist(draft)
    expect((await store.restore(store.read(draft.scope, null)!)).photos[0].blob).toBeInstanceOf(Blob)
  })

  it('re-saves shared media if a new edit is written while old snapshot media cleanup is pending', async () => {
    const storage = memoryStorage()
    const idb = createIndexedDraftMediaStore(new IDBFactory())
    let release!: () => void
    let deleting!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const deletionStarted = new Promise<void>((resolve) => { deleting = resolve })
    const store = createComposerDraftStore(storage, { ...idb, delete: async (key) => { deleting(); await gate; await idb.delete(key) } })
    const old = record('local:local:', null, true)
    await store.persist(old)
    const clearing = store.clearSnapshot(old)
    await deletionStarted
    const newer = makeComposerDraft(old.scope, null, { ...old.fields, text: '清理期间继续写' }, old.baselineFingerprint, old, old)
    const writing = store.persist(newer)
    release()
    await Promise.all([clearing, writing])
    expect((await store.restore(store.read(old.scope, null)!)).photos[0].blob).toBeInstanceOf(Blob)
    expect(store.read(old.scope, null)?.fields.text).toBe('清理期间继续写')
  })

  it('does not silently restore an empty media list when a referenced transaction is missing', async () => {
    const storage = memoryStorage()
    const draft = record('local:local:', null, true)
    storage.setItem(composerDraftKey(draft.scope, null), JSON.stringify({ ...draft, fields: { ...draft.fields, photos: draft.fields.photos.map((photo) => ({ ...photo, src: '' })) } }))
    const store = createComposerDraftStore(storage, createIndexedDraftMediaStore(new IDBFactory()))
    await expect(store.restore(store.read(draft.scope, null)!)).rejects.toThrow('媒体未能恢复')
  })

  it('never assigns the ownerless legacy draft to a cloud account or an edited memory', () => {
    const storage = memoryStorage()
    storage.setItem('only-us-compose-draft', JSON.stringify(record().fields))
    const store = createComposerDraftStore(storage)
    expect(store.read('cloudbase:space:user', null, baseline())).toBe(null)
    expect(store.read('local:local:', 'old-memory', baseline())).toBe(null)
    expect(storage.getItem('only-us-compose-draft')).not.toBe(null)
    expect(store.read('local:local:', null, baseline())?.fields.text).toBe('最后一字也要保留')
    expect(storage.getItem('only-us-compose-draft')).toBe(null)
  })

  it('ignores ownerless empty legacy drafts even when their old default date differs', () => {
    const storage = memoryStorage()
    storage.setItem('only-us-compose-draft', JSON.stringify({ ...baseline(), date: '2020-01-01' }))
    expect(createComposerDraftStore(storage).read('local:local:', null, baseline())).toBe(null)
  })

  it('restores edited memory fields only from their exact scoped key', async () => {
    const store = createComposerDraftStore(memoryStorage())
    const edit = record('cloudbase:space:user', 'memory-42')
    await store.persist(edit)
    expect(store.read(edit.scope, 'memory-42')?.fields.text).toBe(edit.fields.text)
    expect(store.read(edit.scope, 'memory-43')).toBe(null)
  })

  it('records the first publication timestamp even when layout was already prepared in the draft', () => {
    const first = record()
    first.layoutReady = true
    const submitted = makeComposerDraft(first.scope, null, first.fields, first.baselineFingerprint,
      { memoryId: first.memoryId, createdAt: '2026-10-19T08:00:00Z', layoutReady: true }, first)
    expect(submitted.createdAt).toBe('2026-10-19T08:00:00Z')
    expect(submitted.snapshotId).not.toBe(first.snapshotId)
  })

  it('never reuses another scope snapshot or media key even when field values match', () => {
    const first = record('cloud:space:user-a', null, true)
    const second = makeComposerDraft('cloud:space:user-b', null, first.fields, first.baselineFingerprint,
      { memoryId: 'other-account-new-id', createdAt: '' }, first)
    expect(second.scope).toBe('cloud:space:user-b')
    expect(second.memoryId).toBe('other-account-new-id')
    expect(second.mediaKey).not.toBe(first.mediaKey)
  })
})
