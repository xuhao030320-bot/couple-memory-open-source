import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../types'
import { createComposerInitialState, draftFingerprint, type ComposeDraft } from './compose-state'

const today = '2026-10-02'

function savedMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'saved-memory',
    title: '',
    originalText: '',
    displayText: '',
    date: '2026-09-01',
    location: '',
    style: 'cream',
    template: 'hero-note',
    photos: [],
    tags: [],
    category: 'daily',
    moodEmoji: '',
    moodText: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function unsavedDraft(): ComposeDraft {
  return {
    title: '未完成的旅行',
    text: '这段文字还没发布',
    date: '2026-10-01',
    location: '草稿里的海边',
    latitude: 22.5,
    longitude: 114.1,
    category: 'travel',
    moodEmoji: '🌊',
    moodText: '草稿心情',
    themeColor: '#123456',
    style: 'ticket',
    template: 'film-strip',
    tags: ['草稿标签'],
  }
}

describe('composer source isolation', () => {
  it('keeps saved empty fields and absent optional fields instead of filling them from a new draft', () => {
    const state = createComposerInitialState(savedMemory(), unsavedDraft(), false, today)

    expect(state.fields).toEqual({
      title: '',
      text: '',
      date: '2026-09-01',
      location: '',
      latitude: undefined,
      longitude: undefined,
      category: 'daily',
      moodEmoji: '',
      moodText: '',
      themeColor: '',
      style: 'cream',
      template: 'hero-note',
      photos: [],
      tags: [],
    })
    expect(state.restoredFromDraft).toBe(false)
    expect(draftFingerprint(state.fields)).toBe(draftFingerprint(state.baseline))
  })

  it('uses defaults for legacy missing fields even when a complete new draft exists', () => {
    const legacyMemory = {
      id: 'legacy-memory',
      originalText: '旧回忆的原文',
      createdAt: '2026-09-01T00:00:00.000Z',
    } as MemoryEntry
    const state = createComposerInitialState(legacyMemory, unsavedDraft(), false, today)

    expect(state.fields).toEqual({
      title: '',
      text: '旧回忆的原文',
      date: today,
      location: '',
      latitude: undefined,
      longitude: undefined,
      category: 'daily',
      moodEmoji: '🥰',
      moodText: '',
      themeColor: '',
      style: 'cream',
      template: 'hero-note',
      photos: [],
      tags: [],
    })
    expect(draftFingerprint(state.fields)).toBe(draftFingerprint(state.baseline))
  })

  it('preserves the saved text, theme, tags and zero-valued coordinates', () => {
    const state = createComposerInitialState(savedMemory({
      originalText: '原文',
      displayText: '已发布的文字',
      latitude: 0,
      longitude: 0,
      themeColor: '#abcdef',
      tags: ['旧标签'],
    }), unsavedDraft(), false, today)

    expect(state.fields).toMatchObject({
      text: '已发布的文字',
      latitude: 0,
      longitude: 0,
      themeColor: '#abcdef',
      tags: ['旧标签'],
    })
  })

  it('restores the entire new draft after visiting a saved memory without mutating the draft', () => {
    const draft = unsavedDraft()
    const originalDraft = structuredClone(draft)
    createComposerInitialState(savedMemory({ location: '旧地点', moodText: '旧心情' }), draft, true, today)
    const state = createComposerInitialState(null, draft, false, today)

    expect(draft).toEqual(originalDraft)
    expect(state.fields).toEqual({ ...originalDraft, photos: [] })
    expect(state.restoredFromDraft).toBe(true)
    expect(draftFingerprint(state.fields)).not.toBe(draftFingerprint(state.baseline))
  })

  it('starts a clean new memory with today and no saved draft', () => {
    const state = createComposerInitialState(null, null, false, today)

    expect(state.fields).toMatchObject({ date: today, location: '', moodEmoji: '🥰', themeColor: '', photos: [] })
    expect(state.restoredFromDraft).toBe(false)
    expect(draftFingerprint(state.fields)).toBe(draftFingerprint(state.baseline))
  })

  it('compares a rerolled memory to its original layout and leaves a new draft layout intact', () => {
    const memory = savedMemory()
    const edited = createComposerInitialState(memory, unsavedDraft(), true, today)

    expect(edited.fields.template).toBe('quiet-column')
    expect(edited.baseline.template).toBe('hero-note')
    expect(memory.template).toBe('hero-note')
    expect(draftFingerprint(edited.fields)).not.toBe(draftFingerprint(edited.baseline))
    expect(createComposerInitialState(null, unsavedDraft(), true, today).fields.template).toBe('film-strip')
  })

  it('marks a theme-only edit as unsaved and becomes clean again when the theme is restored', () => {
    const { fields, baseline } = createComposerInitialState(savedMemory(), null, false, today)
    const changed = { ...fields, themeColor: '#123456' }

    expect(draftFingerprint(changed)).not.toBe(draftFingerprint(baseline))
    expect(draftFingerprint({ ...changed, themeColor: fields.themeColor })).toBe(draftFingerprint(baseline))
  })
})
