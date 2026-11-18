import { describe, expect, it } from 'vitest'
import { daysSince } from './date'

describe('daysSince', () => {
  it('returns 0 for the same day', () => {
    expect(daysSince('2026-08-15', new Date(2026, 7, 15))).toBe(0)
  })

  it('counts elapsed days for past dates', () => {
    expect(daysSince('2026-07-09', new Date(2026, 7, 15))).toBe(37)
    expect(daysSince('2026-08-14', new Date(2026, 7, 15))).toBe(1)
  })

  it('returns null for future dates so the badge hides', () => {
    expect(daysSince('2026-08-16', new Date(2026, 7, 15))).toBeNull()
  })

  it('returns null for invalid dates', () => {
    expect(daysSince('not-a-date', new Date(2026, 7, 15))).toBeNull()
  })
})
