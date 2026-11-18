import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../types'
import {
  groupMemoriesByMonth,
  inferMediaKind,
  inferMemoryCategory,
  nextLayoutTemplate,
  normalizeMemory,
  tagsWithCategory,
} from './memory'

function memory(id: string, date: string, category: MemoryEntry['category']): MemoryEntry {
  return {
    id,
    title: id,
    originalText: '',
    displayText: '',
    date,
    location: '',
    style: 'cream',
    template: 'hero-note',
    photos: [],
    tags: [],
    category,
    moodEmoji: '',
    moodText: '',
    createdAt: `${date}T12:00:00.000Z`,
  }
}

describe('memory helpers', () => {
  it('uses the saved category instead of guessing from tags', () => {
    expect(inferMemoryCategory({ category: 'travel', tags: [] })).toBe('travel')
    expect(inferMemoryCategory({ tags: ['周年快乐'] })).toBe('anniversary')
    expect(inferMemoryCategory({ tags: [] })).toBe('daily')
  })

  it('keeps exactly one canonical category tag', () => {
    expect(tagsWithCategory(['日常', '散步', '旅行'], 'travel')).toEqual(['旅行', '散步'])
  })

  it('cycles to a visibly different layout', () => {
    expect(nextLayoutTemplate('hero-note', 1)).toBe('quiet-column')
    expect(nextLayoutTemplate('hero-grid', 4)).toBe('film-strip')
  })

  it('defaults a missing isLiked to false and preserves explicit values', () => {
    expect(normalizeMemory(memory('a', '2026-01-01', 'daily')).isLiked).toBe(false)
    expect(normalizeMemory({ ...memory('b', '2026-01-02', 'daily'), isLiked: true }).isLiked).toBe(true)
    expect(normalizeMemory({ ...memory('c', '2026-01-03', 'daily'), isLiked: false }).isLiked).toBe(false)
  })

  it('recognizes videos even when the browser omits a MIME type', () => {
    expect(inferMediaKind('video/quicktime', 'live.mov')).toBe('video')
    expect(inferMediaKind('', 'live.MOV')).toBe('video')
    expect(inferMediaKind('image/jpeg', 'photo.jpg')).toBe('image')
  })

  it('groups memories by month newest first', () => {
    const groups = groupMemoriesByMonth([
      memory('older', '2026-05-02', 'daily'),
      memory('newer', '2026-06-03', 'travel'),
      memory('same-month', '2026-06-01', 'daily'),
    ])
    expect(groups.map((group) => group.key)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].memories.map((item) => item.id)).toEqual(['newer', 'same-month'])
  })
})
