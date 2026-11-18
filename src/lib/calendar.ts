export interface CalendarDay {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

/**
 * 生成一个月的日历网格：周一起始，前导/尾随日期补齐整周。
 * today 可注入，便于测试。
 */
export function buildMonthGrid(year: number, month: number, today = new Date()): CalendarDay[][] {
  const first = new Date(year, month - 1, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const todayKey = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
  const start = new Date(year, month - 1, 1 - offset)
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7

  const weeks: CalendarDay[][] = []
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    const weekIndex = Math.floor(i / 7)
    if (!weeks[weekIndex]) weeks[weekIndex] = []
    weeks[weekIndex].push({
      date: key,
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() === month - 1,
      isToday: key === todayKey,
    })
  }
  return weeks
}
