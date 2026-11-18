import { describe, expect, it } from 'vitest'
import type { AnniversaryEntry } from '../../types'
import {
  daysElapsedSince,
  formatAnniversaryCountdown,
  formatMilestoneCountdown,
  getAnniversaryOccurrence,
  getUpcomingAnniversaries,
  relationshipAnniversary,
} from './anniversary'

function entry(overrides: Partial<AnniversaryEntry> = {}): AnniversaryEntry {
  return {
    id: 'date-1',
    title: '我们的纪念日',
    date: '2024-08-20',
    repeatsYearly: true,
    kind: 'love',
    note: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('daysElapsedSince', () => {
  it('counts days between the event date and today', () => {
    expect(daysElapsedSince('2026-08-01', new Date(2026, 7, 15))).toBe(14)
  })

  it('counts across New Year without an off-by-one', () => {
    expect(daysElapsedSince('2025-12-20', new Date(2026, 0, 5))).toBe(16)
  })

  it('returns zero on the day itself and negative for future dates', () => {
    expect(daysElapsedSince('2026-08-15', new Date(2026, 7, 15))).toBe(0)
    expect(daysElapsedSince('2026-09-01', new Date(2026, 7, 15))).toBe(-17)
  })

  it('treats an invalid date as zero elapsed', () => {
    expect(daysElapsedSince('not-a-date', new Date(2026, 7, 15))).toBe(0)
  })
})

describe('anniversary dates', () => {
  it('uses this year when the yearly date is still ahead', () => {
    const result = getAnniversaryOccurrence(entry(), new Date(2026, 7, 9))
    expect(result).toMatchObject({ date: '2026-08-20', daysAway: 11, years: 2 })
  })

  it('rolls a yearly date into next year after it passes', () => {
    const result = getAnniversaryOccurrence(entry(), new Date(2026, 8, 1))
    expect(result).toMatchObject({ date: '2027-08-20', daysAway: 353, years: 3 })
  })

  it('returns zero on the anniversary itself', () => {
    const result = getAnniversaryOccurrence(entry(), new Date(2026, 7, 20))
    expect(result?.daysAway).toBe(0)
    expect(formatAnniversaryCountdown(0)).toBe('就是今天')
  })

  it('composes the home milestone countdown line', () => {
    expect(formatMilestoneCountdown(45, 3)).toBe('还有 45 天 · 即将迎来第 3 年')
    expect(formatMilestoneCountdown(1, 2)).toBe('明天见 · 即将迎来第 2 年')
    expect(formatMilestoneCountdown(0, 3)).toBe('已是第 3 年')
    expect(formatMilestoneCountdown(0, null)).toBe('就是今天')
    expect(formatMilestoneCountdown(10, null)).toBe('还有 10 天')
  })

  it('does not offer an expired one-time date as upcoming', () => {
    const result = getAnniversaryOccurrence(
      entry({ date: '2025-01-01', repeatsYearly: false }),
      new Date(2026, 0, 1),
    )
    expect(result).toBeNull()
  })

  it('treats February 29 as February 28 in a non-leap year', () => {
    const result = getAnniversaryOccurrence(
      entry({ date: '2024-02-29' }),
      new Date(2025, 0, 1),
    )
    expect(result).toMatchObject({ date: '2025-02-28', years: 1 })
  })

  it.each([
    'not-a-date',
    '2024-2-03',
    '2024-02-30',
    '2023-02-29',
    '2024-13-01',
  ])('rejects the invalid date %s', (date) => {
    expect(getAnniversaryOccurrence(entry({ date }), new Date(2026, 0, 1))).toBeNull()
  })

  it('counts across New Year without a timezone off-by-one', () => {
    const result = getAnniversaryOccurrence(
      entry({ date: '2024-01-01' }),
      new Date(2026, 11, 31),
    )
    expect(result).toMatchObject({ date: '2027-01-01', daysAway: 1, years: 3 })
  })

  it('sorts upcoming entries without mutating the source list', () => {
    const source = [
      entry({ id: 'later', title: '晚一些', date: '2024-12-31' }),
      entry({ id: 'soon', title: '近一些', date: '2024-08-10' }),
    ]
    const originalOrder = source.map((item) => item.id)
    const result = getUpcomingAnniversaries(source, new Date(2026, 7, 9))
    expect(result.map((item) => item.entry.id)).toEqual(['soon', 'later'])
    expect(source.map((item) => item.id)).toEqual(originalOrder)
  })

  it('preserves source order when all sort keys are equal', () => {
    const source = [
      entry({ id: 'first' }),
      entry({ id: 'second' }),
      entry({ id: 'third' }),
    ]

    const result = getUpcomingAnniversaries(source, new Date(2026, 7, 9))

    expect(result.map((item) => item.entry.id)).toEqual(['first', 'second', 'third'])
  })

  it('builds the yearly system anniversary from the relationship start date', () => {
    const result = relationshipAnniversary({
      personA: '小满',
      personB: '阿禾',
      startDate: '2023-05-20',
    })

    expect(result).toEqual({
      id: 'relationship-start',
      title: '我们在一起',
      date: '2023-05-20',
      repeatsYearly: true,
      kind: 'love',
      note: '故事开始的那一天',
      createdAt: '2023-05-20',
      isSystem: true,
    })
    expect(getAnniversaryOccurrence(result, new Date(2026, 4, 19))).toMatchObject({
      date: '2026-05-20',
      daysAway: 1,
      years: 3,
    })
  })
})
