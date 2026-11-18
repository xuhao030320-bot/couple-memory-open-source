function pad2(value: number) {
  return String(value).padStart(2, '0')
}

/** null 表示立刻可见；无效时间戳按已揭开处理，避免一条坏数据永远卡住。 */
export function isRevealed(revealAt: string | null, now = Date.now()): boolean {
  if (!revealAt) return true
  const time = new Date(revealAt).getTime()
  if (Number.isNaN(time)) return true
  return now >= time
}

/** 今晚 0 点 = 今天的本地 24:00（即下一个本地午夜）。 */
export function tonightTimestamp(now = new Date()): string {
  const time = new Date(now)
  time.setHours(24, 0, 0, 0)
  return time.toISOString()
}

/** 明天早上 = 明天本地 08:00。 */
export function tomorrowMorningTimestamp(now = new Date()): string {
  const time = new Date(now)
  time.setDate(time.getDate() + 1)
  time.setHours(8, 0, 0, 0)
  return time.toISOString()
}

/**
 * 揭开时间的展示文案：今天只显示「HH:mm」，其他日期显示「M月D日 HH:mm」。
 * 手动补零而非依赖 Intl 的 hour/minute，保证 00:00（今晚 0 点）在浏览器与
 * vitest(Node ICU) 环境里输出完全一致——这是本项目的确定性 UI 要求。
 */
export function formatRevealTime(revealAt: string, now = new Date()): string {
  const time = new Date(revealAt)
  if (Number.isNaN(time.getTime())) return '稍后'
  const hhmm = `${pad2(time.getHours())}:${pad2(time.getMinutes())}`
  const sameDay =
    time.getFullYear() === now.getFullYear()
    && time.getMonth() === now.getMonth()
    && time.getDate() === now.getDate()
  return sameDay ? hhmm : `${time.getMonth() + 1}月${time.getDate()}日 ${hhmm}`
}
