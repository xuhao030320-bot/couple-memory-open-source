import { describe, expect, it } from 'vitest'
import type { PhotoAsset } from '../types'
import { contentTypeForAsset, extensionForMime } from './cloud-storage'
import { filesToPhotoAssets } from './image'

function videoAsset(mimeType: string): PhotoAsset {
  return {
    id: '3fb8baad-cb10-4fa8-93d3-08f3e64267d5',
    src: '',
    name: 'live.MOV',
    alt: 'video',
    caption: '',
    order: 0,
    role: 'cover',
    focusX: 0.5,
    focusY: 0.5,
    kind: 'video',
    mimeType,
  }
}

describe('media upload normalization', () => {
  it('keeps compressed JPEG bytes and the storage extension aligned', () => {
    expect(extensionForMime('image/jpeg', 'original.png')).toBe('jpg')
  })

  it('uses the inferred asset MIME when a Blob is generic', () => {
    const blob = new Blob(['video'], { type: 'application/octet-stream' })
    expect(contentTypeForAsset(videoAsset('video/quicktime'), blob)).toBe('video/quicktime')
  })

  it('accepts an iPhone MOV even when the browser omits its MIME type', async () => {
    const file = new File(['video'], 'live.MOV', { type: '' })
    const [asset] = await filesToPhotoAssets([file])
    expect(asset.kind).toBe('video')
    expect(asset.mimeType).toBe('video/quicktime')
    expect(asset.blob).toBe(file)
    expect(asset.src.startsWith('blob:')).toBe(true)
    URL.revokeObjectURL(asset.src)
  })
})
