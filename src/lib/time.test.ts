import { describe, expect, it } from 'vitest'
import {
  formatRevealTime,
  isRevealed,
  tomorrowMorningTimestamp,
  tonightTimestamp,
} from './time'

describe('isRevealed', () => {
  it('returns true when there is no reveal time (立刻)', () => {
    expect(isRevealed(null, 1_700_000_000_000)).toBe(true)
  })

  it('returns false before the reveal time', () => {
    const now = new Date(2026, 7, 15, 10, 0, 0).getTime()
    expect(isRevealed(new Date(2026, 7, 15, 12, 0, 0).toISOString(), now)).toBe(false)
  })

  it('returns true at or after the reveal time', () => {
    const at = new Date(2026, 7, 15, 10, 0, 0).getTime()
    expect(isRevealed(new Date(2026, 7, 15, 10, 0, 0).toISOString(), at)).toBe(true)
    expect(isRevealed(new Date(2026, 7, 15, 8, 0, 0).toISOString(), at)).toBe(true)
  })

  it('returns true for invalid timestamps so a broken message is never stuck hidden', () => {
    expect(isRevealed('not-a-date', 0)).toBe(true)
  })
})

describe('tonightTimestamp', () => {
  it('is the next local midnight (今晚 0 点)', () => {
    const now = new Date(2026, 7, 15, 23, 45)
    expect(tonightTimestamp(now)).toBe(new Date(2026, 7, 16, 0, 0, 0, 0).toISOString())
  })
})

describe('tomorrowMorningTimestamp', () => {
  it('is tomorrow 08:00 local (明天早上)', () => {
    const now = new Date(2026, 7, 15, 20, 0)
    expect(tomorrowMorningTimestamp(now)).toBe(new Date(2026, 7, 16, 8, 0, 0, 0).toISOString())
  })
})

describe('formatRevealTime', () => {
  it('shows only time when the reveal is today', () => {
    expect(formatRevealTime(new Date(2026, 7, 15, 23, 0, 0).toISOString(), new Date(2026, 7, 15, 10, 0))).toBe('23:00')
  })

  it('includes month and day when the reveal is another day', () => {
    expect(formatRevealTime(new Date(2026, 7, 16, 8, 0, 0).toISOString(), new Date(2026, 7, 15, 10, 0))).toBe('8月16日 08:00')
  })

  it('falls back to 稍后 for invalid input', () => {
    expect(formatRevealTime('not-a-date')).toBe('稍后')
  })
})
