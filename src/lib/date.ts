const DAY_MS = 24 * 60 * 60 * 1000

export function toISODate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function daysFromToday(offset: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return toISODate(date)
}

export function daysTogether(startDate: string) {
  const start = new Date(`${startDate}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1)
}

export function daysUntil(targetDate: string) {
  if (!targetDate) return null
  const target = new Date(`${targetDate}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / DAY_MS)
}

export function daysSince(dateValue: string, today = new Date()) {
  const target = new Date(`${dateValue}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const current = new Date(today)
  current.setHours(0, 0, 0, 0)
  const difference = Math.floor((current.getTime() - target.getTime()) / DAY_MS)
  return difference < 0 ? null : difference
}

export function formatMemoryDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

export function formatFullDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}
