import type { CloudTrashItem, TrashKind } from './providers'
import type { AnniversaryEntry, MemoryEntry, MessageItem, PartnerNote, WishItem } from '../types'
import { getAnniversaries, getMemories, getProfile, getWishes, putMemory, saveAnniversaries, saveWishes } from './storage'
import { updateLocalMessages } from './local-messages'
import { updateLocalPartnerNotes } from './partner-notes-data'

type Payload = MemoryEntry | MessageItem | PartnerNote | WishItem | AnniversaryEntry
interface LocalTrashRecord extends CloudTrashItem { scope: string; payload: Payload; originalId: string }
const RETENTION = 30 * 24 * 60 * 60 * 1000
const DATABASE = 'only-us-local-trash'
const STORE = 'entries'

function localScope(scope: string) {
  if (scope !== 'local') throw new Error('本地回收站无法访问其他空间')
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const request = indexedDB.open(DATABASE, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
  const db = await requestResult(request)
  try {
    const tx = db.transaction(STORE, mode)
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('回收站未能保存，请重试'))
      tx.onabort = () => reject(tx.error || new Error('回收站操作已取消'))
    })
    const [result] = await Promise.all([requestResult(action(tx.objectStore(STORE))), done])
    return result
  } finally { db.close() }
}

/** Persist media Blobs before removing the active record. */
export async function moveLocalToTrash(scope: string, kind: TrashKind, payload: Payload) {
  localScope(scope)
  const now = Date.now()
  const title = 'title' in payload ? payload.title : payload.text
  const record: LocalTrashRecord = {
    id: `${scope}:${kind}:${payload.id}`, scope, kind, originalId: payload.id,
    title: title.slice(0, 100) || '未命名记录',
    deletedAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION).toISOString(), payload,
  }
  await transact('readwrite', (store) => store.put(record))
}

export async function listLocalTrash(scope = 'local'): Promise<CloudTrashItem[]> {
  localScope(scope)
  const entries = await transact('readonly', (store) => store.getAll()) as LocalTrashRecord[]
  const now = Date.now()
  const own = entries.filter((entry) => entry.scope === scope)
  await Promise.all(own.filter((entry) => Date.parse(entry.expiresAt) <= now)
    .map((entry) => transact('readwrite', (store) => store.delete(entry.id))))
  return own.filter((entry) => Date.parse(entry.expiresAt) > now)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    .map(({ id, kind, title, deletedAt, expiresAt, originalId }) => ({ id, kind, title, deletedAt, expiresAt, originalId }))
}

async function ownedRecord(scope: string, id: string) {
  localScope(scope)
  const record = await transact('readonly', (store) => store.get(id)) as LocalTrashRecord | undefined
  if (!record || record.scope !== scope) throw new Error('这条回收记录已不存在')
  return record
}

export async function purgeLocalTrash(scope: string, id: string) {
  await ownedRecord(scope, id)
  await transact('readwrite', (store) => store.delete(id))
}

export async function restoreLocalTrash(scope: string, id: string) {
  const record = await ownedRecord(scope, id)
  if (Date.parse(record.expiresAt) <= Date.now()) throw new Error('这条记录已超过 30 天，无法恢复')
  const ensureAbsent = (rows: Array<{ id: string }>) => {
    if (rows.some((row) => row.id === record.originalId)) throw new Error('原位置已有同一条记录，未覆盖现有内容')
  }
  switch (record.kind) {
    case 'memory': {
      ensureAbsent(await getMemories())
      await putMemory(record.payload as MemoryEntry)
      break
    }
    case 'partner_note':
      updateLocalPartnerNotes(scope, (rows) => { ensureAbsent(rows); return [...rows, record.payload as PartnerNote] })
      break
    case 'message':
      updateLocalMessages((rows) => { ensureAbsent(rows); return [...rows, record.payload as MessageItem] })
      break
    case 'wish': {
      const rows = getWishes()
      ensureAbsent(rows)
      saveWishes([...rows, record.payload as WishItem])
      break
    }
    case 'anniversary': {
      const rows = getAnniversaries(getProfile())
      ensureAbsent(rows)
      saveAnniversaries([...rows, record.payload as AnniversaryEntry])
      break
    }
    default: throw new Error('这类记录暂时无法恢复')
  }
  await transact('readwrite', (store) => store.delete(id))
}
