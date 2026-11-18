import type { MemoryEntry } from '../../types'

export interface MonthlyMemoryActivity {
  key: string
  year: number
  month: number
  count: number
}

/** Calendar dates stay in the local calendar; parsing ISO strings as UTC can move a day. */
export function monthlyMemoryActivity(
  memories: ReadonlyArray<Pick<MemoryEntry, 'date' | 'isDemo'>>,
  today = new Date(),
): MonthlyMemoryActivity[] {
  const currentMonth = today.getFullYear() * 12 + today.getMonth()
  const months = Array.from({ length: 6 }, (_, index) => {
    const ordinal = currentMonth - 5 + index
    const year = Math.floor(ordinal / 12)
    const month = ordinal % 12 + 1
    return { key: `${year}-${String(month).padStart(2, '0')}`, year, month, count: 0 }
  })
  const byMonth = new Map(months.map((month) => [month.key, month]))

  for (const memory of memories) {
    if (memory.isDemo) continue
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(memory.date)
    if (!match) continue
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) continue
    const bucket = byMonth.get(`${match[1]}-${match[2]}`)
    if (bucket) bucket.count += 1
  }
  return months
}
