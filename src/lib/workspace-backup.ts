import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/lib/zip-core-custom.js'
import type { AnniversaryEntry, CoupleProfile, MemoryEntry, MessageItem, PartnerNote, PhotoAsset, WishItem } from '../types'

export interface BackupSnapshot {
  provider: string
  scope: string
  profile: CoupleProfile
  memories: MemoryEntry[]
  wishes: WishItem[]
  anniversaries: AnniversaryEntry[]
  messages: MessageItem[]
  partnerNotes: PartnerNote[]
}
interface BackupOptions {
  writable?: WritableStream<Uint8Array>
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
  fetchMedia?: (photo: PhotoAsset, signal?: AbortSignal) => Promise<Blob>
}

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'image/heic': 'heic', 'image/heif': 'heif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
}
function safeName(value: string) {
  return value.replace(/[/\\<>:"|?*\u0000-\u001f]/g, '_').replace(/\.{2,}/g, '_').replace(/[. ]+$/g, '').slice(0, 90) || 'media'
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError')
}
async function readMedia(photo: PhotoAsset, signal?: AbortSignal): Promise<Blob> {
  if (photo.blob instanceof Blob) return photo.blob
  if (!photo.src) throw new Error(`无法读取“${photo.name || photo.id}”，备份未完成，请联网后重试`)
  const response = await fetch(photo.src, { signal })
  if (!response.ok) throw new Error(`“${photo.name || photo.id}”下载失败，备份未完成，请重试`)
  const blob = await response.blob()
  if (blob.type.startsWith('text/html') || blob.type.startsWith('application/json')) {
    throw new Error(`“${photo.name || photo.id}”未返回媒体文件，备份未完成`)
  }
  return blob
}

/** An archive is returned only after every referenced photo/video has been copied successfully. */
export async function createWorkspaceBackup(snapshot: BackupSnapshot, options: BackupOptions = {}): Promise<Blob | null> {
  const destination = options.writable || new BlobWriter('application/zip')
  const zip = new ZipWriter(destination, { level: 0, useWebWorkers: false })
  const total = snapshot.memories.reduce((count, memory) => count + memory.photos.length, 0)
  let completed = 0
  const archivedMemories: MemoryEntry[] = []
  options.onProgress?.(0, total)
  for (const [memoryIndex, memory] of snapshot.memories.entries()) {
    const photos: PhotoAsset[] = []
    for (const [photoIndex, photo] of memory.photos.entries()) {
      assertNotAborted(options.signal)
      const blob = await (options.fetchMedia || readMedia)(photo, options.signal)
      assertNotAborted(options.signal)
      const mimeType = blob.type || photo.mimeType
      const extension = extensions[mimeType] || (photo.kind === 'video' ? 'mp4' : 'jpg')
      const basename = safeName(photo.name.replace(/\.[a-z0-9]{1,6}$/i, ''))
      const src = `media/${String(memoryIndex + 1).padStart(4, '0')}-${photoIndex + 1}-${basename}.${extension}`
      await zip.add(src, new BlobReader(blob))
      const { blob: _blob, storagePath: _storagePath, ...metadata } = photo
      photos.push({ ...metadata, src, mimeType })
      completed += 1
      options.onProgress?.(completed, total)
    }
    archivedMemories.push({ ...memory, photos })
  }
  assertNotAborted(options.signal)
  const data = { format: 'only-ours-backup', version: 1, exportedAt: new Date().toISOString(), ...snapshot, memories: archivedMemories }
  await zip.add('manifest.json', new TextReader(JSON.stringify(data, null, 2)))
  await zip.add('index.html', new TextReader(readableBackup(data)))
  await zip.add('使用说明.txt', new TextReader('这是只此我们的空间备份。\n解压后打开 index.html 可查看内容；manifest.json 保存完整记录字段，media 文件夹保存每份媒体的实际文件。\n包含当前可见的回忆、照片和视频、愿望、纪念日、留言及回复、备忘录及原发布时间。\n不包含回收站、未发布草稿或账号登录凭据。仅保存应用中已有的媒体文件，不会重建上传前的原图。\n请将整个文件夹一起保留。\n'))
  assertNotAborted(options.signal)
  const result = await zip.close()
  return result instanceof Blob ? result : null
}

function readableBackup(data: BackupSnapshot & { exportedAt: string }) {
  const text = (value: string) => `<p>${escapeHtml(value)}</p>`
  const mediaUrl = (value: string) => escapeHtml(value.split('/').map(encodeURIComponent).join('/'))
  const memories = data.memories.map((memory) => `<article><h2>${escapeHtml(memory.title)}</h2><small>${escapeHtml(memory.date)} · ${escapeHtml(memory.location)}</small>${text(memory.displayText)}<div class="media">${memory.photos.map((photo) => photo.kind === 'video'
    ? `<video controls src="${mediaUrl(photo.src)}"></video>`
    : `<img src="${mediaUrl(photo.src)}" alt="${escapeHtml(photo.alt)}" loading="lazy">`).join('')}</div></article>`).join('')
  const notes = data.partnerNotes.map((note) => `<article><small>${note.pinned ? '置顶 · ' : ''}${note.kind === 'like' ? '喜欢' : '需要留意'} · ${escapeHtml(note.createdAt || '历史备忘，原时间未记录')}</small>${text(note.text)}</article>`).join('')
  const messages = data.messages.map((message) => `<article><small>${escapeHtml(message.createdAt)}</small>${text(message.text)}${(message.replies || []).map((reply) => `<blockquote><small>${escapeHtml(reply.createdAt)}</small>${text(reply.text)}</blockquote>`).join('')}</article>`).join('')
  const wishes = data.wishes.map((wish) => `<li>${wish.completed ? '✓' : '○'} ${escapeHtml(wish.text)}</li>`).join('')
  const anniversaries = data.anniversaries.map((item) => `<li>${escapeHtml(item.date)} · ${escapeHtml(item.title)}${text(item.note)}</li>`).join('')
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data:; media-src 'self' file:; style-src 'unsafe-inline';"><title>只此我们 · 空间备份</title><style>body{max-width:900px;margin:40px auto;padding:0 20px;background:#fff8f2;color:#463936;font:16px/1.8 system-ui}h1,h2{font-weight:600}article{margin:20px 0;padding:22px;border:1px solid #eadbd5;border-radius:18px;background:#fffdf9}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#756761}.media{display:flex;flex-wrap:wrap;gap:12px}img,video{max-width:100%;max-height:500px;object-fit:contain}blockquote{margin-left:12px;border-left:2px solid #eadbd5;padding-left:16px}a{color:#963a49}nav{display:flex;flex-wrap:wrap;gap:20px}</style><h1>${escapeHtml(data.profile.personA)} &amp; ${escapeHtml(data.profile.personB)}</h1><p>故事开始于 ${escapeHtml(data.profile.startDate)} · 导出于 ${escapeHtml(data.exportedAt)}</p><nav><a href="#memories">回忆</a><a href="#notes">备忘录</a><a href="#messages">留言</a><a href="#wishes">愿望</a><a href="#anniversaries">纪念日</a></nav><h2 id="memories">回忆</h2>${memories || '<p>暂无回忆</p>'}<h2 id="notes">备忘录</h2>${notes || '<p>暂无备忘</p>'}<h2 id="messages">留言</h2>${messages || '<p>暂无留言</p>'}<h2 id="wishes">愿望</h2><ul>${wishes}</ul><h2 id="anniversaries">纪念日</h2><ul>${anniversaries}</ul></html>`
}
