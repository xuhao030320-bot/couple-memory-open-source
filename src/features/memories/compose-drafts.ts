import type { PhotoAsset } from '../../types'
import { createComposerInitialState, draftFingerprint, type ComposerFields } from './compose-state'

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface DraftMediaStore {
  prepare?: () => Promise<void>
  put: (key: string, photos: PhotoAsset[]) => Promise<void>
  get: (key: string) => Promise<PhotoAsset[] | undefined>
  delete: (key: string) => Promise<void>
}
export interface ComposerDraftRecord {
  version: 2
  scope: string
  target: string | null
  snapshotId: string
  memoryId: string
  createdAt: string
  baselineFingerprint: string
  fields: ComposerFields
  mediaKey?: string
  mediaReady: boolean
  layoutReady?: boolean
}

const DB_NAME = 'only-us-memory-drafts'
const STORE = 'media'
const LEGACY_KEY = 'only-us-compose-draft'

export function composerDraftKey(scope: string, target: string | null) {
  return `only-us-compose-draft:v2:${encodeURIComponent(scope)}:${target === null ? 'new' : `edit-${encodeURIComponent(target)}`}`
}

export function createIndexedDraftMediaStore(factory?: IDBFactory): DraftMediaStore {
  let connection: Promise<IDBDatabase> | undefined
  function open() {
    if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
      const idb = factory ?? globalThis.indexedDB
      if (!idb) { reject(new Error('浏览器暂时无法保存媒体草稿')); return }
      const request = idb.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onerror = () => { connection = undefined; reject(request.error) }
      request.onblocked = () => { connection = undefined; reject(new Error('媒体草稿数据库正在被其他页面使用')) }
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); connection = undefined }
        resolve(request.result)
      }
    })
    return connection
  }
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const database = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? request.error)
      tx.onabort = () => reject(tx.error ?? new Error('媒体草稿保存中断'))
    })
  }
  return {
    prepare: async () => { await open() },
    put: async (key, photos) => { await transaction('readwrite', (store) => store.put(photos, key)) },
    get: (key) => transaction<PhotoAsset[] | undefined>('readonly', (store) => store.get(key)),
    delete: async (key) => { await transaction('readwrite', (store) => store.delete(key)) },
  }
}

function mediaSignature(photos: PhotoAsset[]) {
  return JSON.stringify(photos.map(({ blob: _blob, src: _src, ...photo }) => photo))
}

function photoAsBlob(photo: PhotoAsset): PhotoAsset {
  if (photo.blob instanceof Blob) return { ...photo, src: '' }
  if (photo.src.startsWith('data:')) {
    const comma = photo.src.indexOf(',')
    const header = photo.src.slice(0, comma)
    const body = photo.src.slice(comma + 1)
    const mime = /^data:([^;,]+)/.exec(header)?.[1] || photo.mimeType
    const bytes = header.includes(';base64')
      ? Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body))
    return { ...photo, src: '', blob: new Blob([bytes], { type: mime }) }
  }
  if (photo.src.startsWith('blob:')) throw new Error(`“${photo.name}”的媒体文件已失效，请重新选择`)
  return { ...photo }
}

function metadata(fields: ComposerFields): ComposerFields {
  return {
    ...fields,
    photos: fields.photos.map(({ blob: _blob, ...photo }) => ({
      ...photo, src: /^(data:|blob:)/.test(photo.src) ? '' : photo.src,
    })),
  }
}

export function makeComposerDraft(
  scope: string,
  target: string | null,
  fields: ComposerFields,
  baselineFingerprint: string,
  identity: { memoryId: string; createdAt: string; layoutReady?: boolean },
  previous?: ComposerDraftRecord | null,
): ComposerDraftRecord {
  if (previous?.scope !== scope || previous.target !== target) previous = null
  if (previous && draftFingerprint(previous.fields) === draftFingerprint(fields)
    && previous.baselineFingerprint === baselineFingerprint && previous.layoutReady === identity.layoutReady
    && previous.memoryId === identity.memoryId && previous.createdAt === identity.createdAt) return { ...previous, fields }
  const requiresMedia = fields.photos.some((photo) => photo.blob instanceof Blob || /^(data:|blob:)/.test(photo.src))
  const sameMedia = previous && mediaSignature(previous.fields.photos) === mediaSignature(fields.photos)
  return {
    version: 2, scope, target, ...identity, snapshotId: crypto.randomUUID(), baselineFingerprint, fields,
    mediaKey: requiresMedia ? sameMedia && previous?.mediaKey ? previous.mediaKey : `${composerDraftKey(scope, target)}:media:${crypto.randomUUID()}` : undefined,
    mediaReady: !requiresMedia || Boolean(sameMedia && previous?.mediaReady),
  }
}

function isFields(value: unknown): value is ComposerFields {
  if (!value || typeof value !== 'object') return false
  const fields = value as ComposerFields
  return ['title', 'text', 'date', 'location', 'moodEmoji', 'moodText', 'themeColor'].every((key) => typeof fields[key as keyof ComposerFields] === 'string')
    && ['daily', 'travel', 'anniversary'].includes(fields.category)
    && ['cream', 'film', 'minimal', 'ticket'].includes(fields.style)
    && ['hero-note', 'hero-grid', 'film-strip', 'quiet-column', 'grid-4', 'grid-6', 'grid-9'].includes(fields.template)
    && Array.isArray(fields.tags) && fields.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(fields.photos) && fields.photos.every((photo) => photo && typeof photo.id === 'string' && typeof photo.src === 'string' && typeof photo.name === 'string')
    && (fields.latitude === undefined || Number.isFinite(fields.latitude))
    && (fields.longitude === undefined || Number.isFinite(fields.longitude))
}

function meaningfulLegacy(fields: ComposerFields) {
  return !!(fields.title.trim() || fields.text.trim() || fields.location.trim() || fields.moodText.trim()
    || fields.tags.length || fields.themeColor || fields.category !== 'daily' || fields.style !== 'cream'
    || fields.template !== 'hero-note' || fields.moodEmoji !== '🥰')
}

export function createComposerDraftStore(storage?: DraftStorage, media: DraftMediaStore = createIndexedDraftMediaStore()) {
  const pending = new Map<string, Promise<void>>()
  const deleting = new Map<string, Promise<void>>()
  const committedMedia = new Set<string>()
  const previewUrls = new Map<string, string>()
  const disk = () => storage ?? window.localStorage
  function raw(scope: string, target: string | null): ComposerDraftRecord | null {
    try {
      const value = JSON.parse(disk().getItem(composerDraftKey(scope, target)) || 'null') as ComposerDraftRecord | null
      return value?.version === 2 && value.scope === scope && value.target === target
        && typeof value.snapshotId === 'string' && typeof value.memoryId === 'string'
        && typeof value.createdAt === 'string' && typeof value.baselineFingerprint === 'string' && isFields(value.fields)
        && (value.mediaKey === undefined || (typeof value.mediaKey === 'string' && value.mediaKey.startsWith(`${composerDraftKey(scope, target)}:media:`))) ? value : null
    } catch { return null }
  }
  function write(record: ComposerDraftRecord) {
    disk().setItem(composerDraftKey(record.scope, record.target), JSON.stringify({ ...record, fields: metadata(record.fields) }))
  }
  async function persist(record: ComposerDraftRecord) {
    if (draftFingerprint(record.fields) === record.baselineFingerprint) {
      return
    }
    const ready = !record.mediaKey || committedMedia.has(record.mediaKey)
    write({ ...record, mediaReady: ready })
    if (!record.mediaKey) return
    const mediaKey = record.mediaKey
    if (!ready && !pending.has(mediaKey)) {
      // Start the IndexedDB transaction immediately. Navigation restores wait for this same promise.
      const hasMediaPayload = record.fields.photos.every((photo) => photo.blob instanceof Blob || !!photo.src)
      const removal = deleting.get(mediaKey)
      const writeMedia = async () => {
        if (hasMediaPayload) await media.put(mediaKey, record.fields.photos.map(photoAsBlob))
        else {
          // A manifest read contains descriptors, not Blob bytes. Flushing it must never overwrite stored media.
          const existing = await media.get(mediaKey)
          if (!existing || record.fields.photos.some((photo) => !existing.some((stored) => stored.id === photo.id))) throw new Error('媒体草稿还未保存完整，请重新选择媒体或重试恢复。')
        }
      }
      const operation = (removal ? removal.catch(() => undefined).then(writeMedia) : writeMedia())
        .then(() => { committedMedia.add(mediaKey) })
      pending.set(mediaKey, operation)
      void operation.finally(() => { if (pending.get(mediaKey) === operation) pending.delete(mediaKey) }).catch(() => undefined)
    }
    await pending.get(mediaKey)
    if (raw(record.scope, record.target)?.snapshotId === record.snapshotId) write({ ...record, mediaReady: true })
    // Never let a late media completion replace the text of a newer snapshot.
  }
  async function restore(record: ComposerDraftRecord): Promise<ComposerFields> {
    if (!record.mediaKey) return record.fields
    await pending.get(record.mediaKey)
    const stored = await media.get(record.mediaKey)
    if (!stored || stored.length !== record.fields.photos.length) throw new Error('草稿文字已保留，但媒体未能恢复，请重试读取；不要直接关闭页面')
    committedMedia.add(record.mediaKey)
    const byId = new Map(stored.map((photo) => [photo.id, photo]))
    return {
      ...record.fields,
      photos: record.fields.photos.map((meta) => {
        const photo = byId.get(meta.id)
        if (!photo) throw new Error('草稿中的部分媒体未能恢复')
        const urlKey = `${record.mediaKey}:${photo.id}`
        let src = photo.src
        if (photo.blob instanceof Blob) {
          if (!previewUrls.has(urlKey)) previewUrls.set(urlKey, URL.createObjectURL(photo.blob))
          src = previewUrls.get(urlKey)!
        }
        return { ...photo, ...meta, src, blob: photo.blob }
      }),
    }
  }
  async function clearSnapshot(record: ComposerDraftRecord) {
    if (raw(record.scope, record.target)?.snapshotId !== record.snapshotId) return false
    disk().removeItem(composerDraftKey(record.scope, record.target))
    if (record.mediaKey) {
      const mediaKey = record.mediaKey
      try {
        await pending.get(mediaKey)
        if (raw(record.scope, record.target)?.mediaKey !== mediaKey) {
          committedMedia.delete(mediaKey)
          const removal = media.delete(mediaKey)
          deleting.set(mediaKey, removal)
          try { await removal } finally { if (deleting.get(mediaKey) === removal) deleting.delete(mediaKey) }
        }
      } catch { /* A stale media row must not turn a successful publication into a failure. */ }
    }
    return true
  }
  function read(scope: string, target: string | null = null, baseline?: ComposerFields) {
    const record = raw(scope, target)
    if (record) return draftFingerprint(record.fields) !== record.baselineFingerprint ? record : null
    // Global v1 drafts have no owner. Only the explicitly local workspace may claim them.
    if (target !== null || !baseline || !['local', 'local:local:'].includes(scope)) return null
    try {
      const legacy = JSON.parse(disk().getItem(LEGACY_KEY) || 'null')
      if (!legacy || typeof legacy.text !== 'string' || typeof legacy.title !== 'string') return null
      const fields = createComposerInitialState(null, { ...legacy, photos: [] }).fields
      if (!isFields(fields) || !meaningfulLegacy(fields)) return null
      const migrated = makeComposerDraft(scope, null, fields, draftFingerprint(baseline), { memoryId: crypto.randomUUID(), createdAt: new Date().toISOString() })
      write(migrated)
      disk().removeItem(LEGACY_KEY)
      return migrated
    } catch { return null }
  }
  return {
    read, persist, restore, clearSnapshot,
    prepare: () => media.prepare?.() ?? Promise.resolve(),
    hasPendingMedia: () => pending.size > 0,
  }
}

export const composerDrafts = createComposerDraftStore()
