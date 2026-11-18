import { dataProvider, type CloudStorageProvider, type CloudWatchHandle } from './providers'
import type { PhotoAsset } from '../types'
export type { CloudSession as Session, CloudTrashItem, TrashKind } from './providers'

let providerPromise: Promise<CloudStorageProvider> | undefined
function loadProvider(): Promise<CloudStorageProvider> {
  if (!providerPromise) {
    providerPromise = (dataProvider === 'cloudbase'
      ? import('./providers/cloudbase')
      : dataProvider === 'supabase' ? import('./providers/supabase')
        : Promise.reject(new Error('当前是本地模式')))
      .catch((error) => { providerPromise = undefined; throw error })
  }
  return providerPromise
}

type AsyncKey = { [K in keyof CloudStorageProvider]: CloudStorageProvider[K] extends (...args: never[]) => Promise<unknown> ? K : never }[keyof CloudStorageProvider]
function asyncMethod<K extends AsyncKey>(key: K) {
  return (async (...args: Parameters<CloudStorageProvider[K]>) => {
    const provider = await loadProvider()
    const method = provider[key] as (...values: Parameters<CloudStorageProvider[K]>) => ReturnType<CloudStorageProvider[K]>
    return method(...args)
  }) as CloudStorageProvider[K]
}
export const signInWithEmail = asyncMethod('signInWithEmail')
export const signUpWithEmail = asyncMethod('signUpWithEmail')
export const signOutCloud = asyncMethod('signOutCloud')
export const getCloudSession = asyncMethod('getCloudSession')
export const createCloudCouple = asyncMethod('createCloudCouple')
export const joinCloudCouple = asyncMethod('joinCloudCouple')
export const loadCloudWorkspace = asyncMethod('loadCloudWorkspace')
export const loadCloudMessages = asyncMethod('loadCloudMessages')
export const putCloudMemory = asyncMethod('putCloudMemory')
export const updateCloudMemory = asyncMethod('updateCloudMemory')
export const removeCloudMemory = asyncMethod('removeCloudMemory')
export const saveCloudProfile = asyncMethod('saveCloudProfile')
export const createCloudAnniversary = asyncMethod('createCloudAnniversary')
export const updateCloudAnniversary = asyncMethod('updateCloudAnniversary')
export const removeCloudAnniversary = asyncMethod('removeCloudAnniversary')
export const createCloudMessage = asyncMethod('createCloudMessage')
export const removeCloudMessage = asyncMethod('removeCloudMessage')
export const addCloudMessageReply = asyncMethod('addCloudMessageReply')
export const syncCloudWishes = asyncMethod('syncCloudWishes')
export const saveCloudMessageNotes = asyncMethod('saveCloudMessageNotes')
export const loadCloudPartnerNotes = asyncMethod('loadCloudPartnerNotes')
export const createCloudPartnerNote = asyncMethod('createCloudPartnerNote')
export const updateCloudPartnerNote = asyncMethod('updateCloudPartnerNote')
export const deleteCloudPartnerNote = asyncMethod('deleteCloudPartnerNote')
export const setCloudPartnerNotePinned = asyncMethod('setCloudPartnerNotePinned')

export async function listCloudTrash(scope: string) {
  if (dataProvider === 'local') return (await import('./local-trash')).listLocalTrash(scope)
  return (await loadProvider()).listCloudTrash(scope)
}
export async function restoreCloudTrash(scope: string, id: string) {
  if (dataProvider === 'local') return (await import('./local-trash')).restoreLocalTrash(scope, id)
  return (await loadProvider()).restoreCloudTrash(scope, id)
}
export async function purgeCloudTrash(scope: string, id: string) {
  if (dataProvider === 'local') return (await import('./local-trash')).purgeLocalTrash(scope, id)
  return (await loadProvider()).purgeCloudTrash(scope, id)
}

function deferredSubscription(start: (provider: CloudStorageProvider) => CloudWatchHandle | (() => void)): CloudWatchHandle {
  let closed = false
  let cleanup: (() => void | Promise<void>) | undefined
  const ready = loadProvider().then((provider) => {
    if (closed) return
    const subscription = start(provider)
    cleanup = typeof subscription === 'function' ? subscription : () => subscription.close()
    if (closed) { const close = cleanup; cleanup = undefined; return close() }
  }).catch((error) => { if (!closed) console.warn('云端监听暂时无法建立', error) })
  return { close() {
    if (closed) return
    closed = true
    const close = cleanup
    cleanup = undefined
    return close ? close() : ready.then(() => undefined)
  } }
}
export function onCloudAuthChange(callback: Parameters<CloudStorageProvider['onCloudAuthChange']>[0]) {
  const handle = deferredSubscription((provider) => provider.onCloudAuthChange(callback))
  return () => { void Promise.resolve(handle.close()).catch((error) => console.warn('云端监听关闭失败', error)) }
}
export function subscribeToCloudWorkspace(coupleId: string, onChange: () => void) {
  return deferredSubscription((provider) => provider.subscribeToCloudWorkspace(coupleId, onChange))
}
export function unsubscribeCloudWorkspace(handle: CloudWatchHandle) {
  void Promise.resolve(handle.close()).catch((error) => console.warn('云端监听关闭失败', error))
}
export function clearSdkSessionStorage() {
  void loadProvider().then((provider) => provider.clearSdkSessionStorage()).catch((error) => console.warn('会话清理失败', error))
}

// Keep synchronous MIME helpers independent of either SDK.
export function extensionForMime(mimeType: string, name: string) {
  const normalized = mimeType.toLowerCase()
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/mp4': 'mp4' }
  if (extensions[normalized]) return extensions[normalized]
  const extension = name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  if (extension && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'mov', 'webm', 'm4v', 'mp4'].includes(extension)) return extension === 'jpeg' ? 'jpg' : extension
  return normalized.startsWith('video/') ? 'mp4' : 'jpg'
}
export function contentTypeForAsset(photo: PhotoAsset, blob: Blob) {
  const detected = blob.type.toLowerCase()
  const expected = photo.mimeType.toLowerCase()
  if (!detected || detected === 'application/octet-stream') return expected
  if (photo.kind === 'video' && !detected.startsWith('video/')) return expected
  if (photo.kind === 'image' && !detected.startsWith('image/')) return expected
  return detected
}
