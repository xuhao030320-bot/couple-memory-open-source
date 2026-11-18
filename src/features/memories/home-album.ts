import type { PhotoAsset } from '../../types'

/** Ignore parent list order; replace the book only when its actual media changes. */
export function homeAlbumVersion(photos: PhotoAsset[]): string {
  return `[${photos.map((photo) => JSON.stringify([
    photo.id, photo.src, photo.storagePath, photo.kind, photo.mimeType,
    photo.alt, photo.caption, photo.focusX, photo.focusY,
  ])).sort().join(',')}]`
}

/** A book owns one immutable page order for its complete mounted lifetime. */
export function createHomeAlbumPages(photos: PhotoAsset[], random = Math.random): PhotoAsset[] {
  const pages = photos.map((photo) => ({ ...photo }))
  for (let index = pages.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[pages[index], pages[swap]] = [pages[swap], pages[index]]
  }
  return pages
}

/** Choose another two-page spread, including a final unpaired photo. */
export function nextHomeAlbumPage(currentPage: number, pageCount: number, random = Math.random): number | null {
  const pagesPerSpread = 2
  const spreadCount = Math.ceil(pageCount / pagesPerSpread)
  if (spreadCount < 2) return null
  const currentSpread = Math.min(spreadCount - 1, Math.max(0, Math.floor(currentPage / pagesPerSpread)))
  const alternative = Math.min(spreadCount - 2, Math.floor(random() * (spreadCount - 1)))
  const nextSpread = alternative >= currentSpread ? alternative + 1 : alternative
  return nextSpread * pagesPerSpread
}
