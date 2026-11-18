import { describe, expect, it } from 'vitest'
import { monthlyMemoryActivity } from './monthly-activity'

describe('monthly memory activity', () => {
  it('counts the six local calendar months across a year boundary', () => {
    const months = monthlyMemoryActivity([
      { date: '2025-08-31' }, { date: '2025-09-01' }, { date: '2025-12-31' },
      { date: '2026-01-01' }, { date: '2026-01-31' }, { date: '2026-02-01' },
    ], new Date(2026, 0, 1, 0, 15))
    expect(months.map(({ key, count }) => [key, count])).toEqual([
      ['2025-08', 1], ['2025-09', 1], ['2025-10', 0],
      ['2025-11', 0], ['2025-12', 1], ['2026-01', 2],
    ])
  })

  it('ignores demo entries and malformed dates without normalizing them into another month', () => {
    const months = monthlyMemoryActivity([
      { date: '2024-02-29' }, { date: '2024-02-30' }, { date: '2024-04-31' },
      { date: '2024-03-01T00:00:00Z' }, { date: '2024-06-01', isDemo: true },
      { date: '2024-06-00' }, { date: '2024-06-15' }, { date: '2024-13-01' },
    ], new Date(2024, 5, 30))
    expect(months.map(({ count }) => count)).toEqual([0, 1, 0, 0, 0, 1])
  })

  it('leaves empty months at zero and counts every record on the same date', () => {
    expect(monthlyMemoryActivity([], new Date(2026, 9, 19)).every(({ count }) => count === 0)).toBe(true)
    const months = monthlyMemoryActivity([{ date: '2026-10-19' }, { date: '2026-10-19' }], new Date(2026, 9, 19))
    expect(months[5].count).toBe(2)
  })
})
