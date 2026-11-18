import type { AnniversaryEntry, CoupleProfile } from '../../types'

const DAY_MS = 24 * 60 * 60 * 1000

interface DateParts {
  year: number
  month: number
  day: number
}

export interface AnniversaryOccurrence {
  entry: AnniversaryEntry
  date: string
  daysAway: number
  years: number | null
}

function parseISODate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function localDateParts(date: Date): DateParts | null {
  if (Number.isNaN(date.getTime())) return null
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

function dateForAnniversary(year: number, month: number, day: number): DateParts {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) }
}

function dayNumber(date: DateParts) {
  const utcDate = new Date(0)
  utcDate.setUTCHours(0, 0, 0, 0)
  utcDate.setUTCFullYear(date.year, date.month - 1, date.day)
  return Math.round(utcDate.getTime() / DAY_MS)
}

function dayDistance(from: DateParts, to: DateParts) {
  return dayNumber(to) - dayNumber(from)
}

function formatISODate(date: DateParts) {
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-')
}

export function getAnniversaryOccurrence(
  entry: AnniversaryEntry,
  today = new Date(),
): AnniversaryOccurrence | null {
  const source = parseISODate(entry.date)
  const start = localDateParts(today)
  if (!source || !start) return null

  if (!entry.repeatsYearly) {
    const eventDate = dateForAnniversary(source.year, source.month, source.day)
    const daysAway = dayDistance(start, eventDate)
    if (daysAway < 0) return null
    return {
      entry,
      date: formatISODate(eventDate),
      daysAway,
      years: null,
    }
  }

  let occurrenceYear = Math.max(start.year, source.year)
  let eventDate = dateForAnniversary(occurrenceYear, source.month, source.day)
  if (dayDistance(start, eventDate) < 0) {
    occurrenceYear += 1
    eventDate = dateForAnniversary(occurrenceYear, source.month, source.day)
  }

  return {
    entry,
    date: formatISODate(eventDate),
    daysAway: dayDistance(start, eventDate),
    years: Math.max(0, occurrenceYear - source.year),
  }
}

export function getUpcomingAnniversaries(
  entries: AnniversaryEntry[],
  today = new Date(),
) {
  const upcoming: Array<{ occurrence: AnniversaryOccurrence; sourceIndex: number }> = []

  entries.forEach((entry, sourceIndex) => {
    const occurrence = getAnniversaryOccurrence(entry, today)
    if (occurrence) upcoming.push({ occurrence, sourceIndex })
  })

  return upcoming
    .sort((a, b) => (
      a.occurrence.daysAway - b.occurrence.daysAway
      || a.occurrence.entry.createdAt.localeCompare(b.occurrence.entry.createdAt)
      || a.occurrence.entry.title.localeCompare(b.occurrence.entry.title, 'zh-CN')
      || a.sourceIndex - b.sourceIndex
    ))
    .map(({ occurrence }) => occurrence)
}

export function relationshipAnniversary(profile: CoupleProfile): AnniversaryEntry {
  return {
    id: 'relationship-start',
    title: '我们在一起',
    date: profile.startDate,
    repeatsYearly: true,
    kind: 'love',
    note: '故事开始的那一天',
    createdAt: profile.startDate,
    isSystem: true,
  }
}

/**
 * 从事件日期到今天经过的天数（不含事件日；事件日当天为 0，未来日期为负数）。
 * 展示时「到今天 X 天」用 elapsed + 1，与 lib/date 的 daysTogether 口径一致。
 */
export function daysElapsedSince(date: string, today = new Date()): number {
  const source = parseISODate(date)
  const start = localDateParts(today)
  if (!source || !start) return 0
  return dayDistance(source, start)
}

export function formatAnniversaryCountdown(daysAway: number) {
  if (daysAway === 0) return '就是今天'
  if (daysAway === 1) return '明天见'
  return `还有 ${daysAway} 天`
}

export function formatMilestoneCountdown(daysAway: number, years: number | null) {
  if (daysAway === 0) return years && years > 0 ? `已是第 ${years} 年` : '就是今天'
  if (daysAway === 1) return years && years > 0 ? `明天见 · 即将迎来第 ${years} 年` : '明天见'
  return years && years > 0 ? `还有 ${daysAway} 天 · 即将迎来第 ${years} 年` : `还有 ${daysAway} 天`
}
