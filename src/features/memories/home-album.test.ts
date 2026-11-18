import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { MemoryEntry, PhotoAsset } from '../../types'
import { HomeView } from '../../views/HomeView'
import { createHomeAlbumPages, homeAlbumVersion, nextHomeAlbumPage } from './home-album'

function photo(id: string, src = `${id}.jpg`): PhotoAsset {
  return { id, src, name: id, alt: id, caption: '', order: 0, role: 'cover', focusX: .5, focusY: .5, kind: 'image', mimeType: 'image/jpeg' }
}

function albumKey(photos: PhotoAsset[]): string | null {
  const tree = HomeView({
    profile: { personA: 'A', personB: 'B', startDate: '2026-01-01' }, myName: 'A',
    memories: [{ id: 'memory', date: '2026-10-19', photos, tags: [] } as unknown as MemoryEntry],
    anniversaries: [], onNavigate() {}, onSettings() {},
  })
  function find(node: ReactNode): string | null {
    if (Array.isArray(node)) {
      for (const child of node) { const found = find(child); if (found !== null) return found }
    }
    if (isValidElement<{ photos?: PhotoAsset[]; children?: ReactNode }>(node)) {
      if (Array.isArray(node.props.photos)) return node.key
      return find(node.props.children)
    }
    return null
  }
  return find(tree)
}

describe('home album media updates', () => {
  it('replaces the mounted book when photos are added, removed, or replaced at the same count', () => {
    const initial = [photo('a'), photo('b')]
    const keys = [initial, [...initial, photo('c')], [initial[0]], [photo('a'), photo('c')], [photo('a', 'renewed.jpg'), photo('b')]]
      .map(albumKey)
    expect(keys.every((key) => key !== null)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(albumKey([photo('b'), photo('a')])).toBe(albumKey(initial))
  })

  it('includes rendering metadata in the version and keeps an unrelated parent reorder stable', () => {
    const initial = [photo('a'), photo('b')]
    expect(homeAlbumVersion([...initial].reverse())).toBe(homeAlbumVersion(initial))
    expect(homeAlbumVersion([{ ...initial[0], focusX: .1 }, initial[1]])).not.toBe(homeAlbumVersion(initial))
    expect(homeAlbumVersion([{ ...initial[0], kind: 'video' }, initial[1]])).not.toBe(homeAlbumVersion(initial))
  })

  it('shuffles a private snapshot without modifying source pages or later changing page order', () => {
    const initial = [photo('a'), photo('b'), photo('c')]
    const pages = createHomeAlbumPages(initial, () => 0)
    expect(pages.map(({ id }) => id)).toEqual(['b', 'c', 'a'])
    expect(initial.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
    const version = pages.map(({ id }) => id)
    initial[0].src = 'updated-after-mount.jpg'
    expect(pages.find(({ id }) => id === 'a')?.src).toBe('a.jpg')
    expect(pages.map(({ id }) => id)).toEqual(version)
  })
})

describe('two-page album automatic navigation', () => {
  it('keeps an empty, single-photo or one-spread album at rest', () => {
    expect(nextHomeAlbumPage(0, 0)).toBeNull()
    expect(nextHomeAlbumPage(0, 1)).toBeNull()
    expect(nextHomeAlbumPage(0, 2)).toBeNull()
    expect(nextHomeAlbumPage(1, 2)).toBeNull()
  })

  it('visits all other complete spreads from either side of the current pair', () => {
    for (let current = 0; current < 5; current++) {
      const targets = [0, .999].map(random => nextHomeAlbumPage(current, 5, () => random))
      expect(new Set(targets)).toEqual(new Set([0, 2, 4].filter(page => page !== Math.floor(current / 2) * 2)))
    }
  })

  it('reaches the odd final page and returns to a whole spread', () => {
    expect(nextHomeAlbumPage(1, 5, () => 0)).toBe(2)
    expect(nextHomeAlbumPage(1, 5, () => .999)).toBe(4)
    expect(nextHomeAlbumPage(4, 5, () => .999)).toBe(2)
    expect(nextHomeAlbumPage(3, 5, () => 0)).toBe(0)
  })
})
