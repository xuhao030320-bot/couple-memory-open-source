import { describe, expect, it } from 'vitest'
import { buildMonthGrid, WEEKDAY_LABELS } from './calendar'

describe('buildMonthGrid', () => {
  it('starts weeks on Monday with leading days from the previous month', () => {
    // 2026-01-01 是星期四 → 前导 3 天（12月29/30/31）
    const weeks = buildMonthGrid(2026, 1, new Date(2026, 0, 1))
    expect(weeks[0][0].date).toBe('2025-12-29')
    expect(weeks[0][0].inMonth).toBe(false)
    expect(weeks[0][3].date).toBe('2026-01-01')
    expect(weeks[0][3].inMonth).toBe(true)
  })

  it('places a month starting on Monday without leading days', () => {
    // 2026-06-01 是星期一
    const weeks = buildMonthGrid(2026, 6, new Date(2026, 5, 1))
    expect(weeks[0][0].date).toBe('2026-06-01')
    expect(weeks[0][0].inMonth).toBe(true)
  })

  it('covers every day of the month and fills complete weeks', () => {
    const weeks = buildMonthGrid(2024, 2, new Date(2024, 1, 10)) // 闰年 2 月
    for (const week of weeks) expect(week).toHaveLength(7)
    const inMonth = weeks.flat().filter((day) => day.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth[0].date).toBe('2024-02-01')
    expect(inMonth[28].date).toBe('2024-02-29')
  })

  it('marks today correctly with an injected date', () => {
    const weeks = buildMonthGrid(2026, 8, new Date(2026, 7, 15))
    const todayCells = weeks.flat().filter((day) => day.isToday)
    expect(todayCells).toHaveLength(1)
    expect(todayCells[0].date).toBe('2026-08-15')
    expect(todayCells[0].inMonth).toBe(true)
  })

  it('keeps Monday-first weekday labels aligned with the grid', () => {
    expect(WEEKDAY_LABELS).toEqual(['一', '二', '三', '四', '五', '六', '日'])
    const weeks = buildMonthGrid(2026, 8, new Date(2026, 7, 15))
    // 2026-08-01 是星期六 → 周一起始的前导 5 天
    expect(weeks[0][5].date).toBe('2026-08-01')
  })
})
