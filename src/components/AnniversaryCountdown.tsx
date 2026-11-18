import { Heart, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnniversaryOccurrence } from '../features/anniversaries/anniversary'
import { useReducedMotion } from '../lib/use-reduced-motion'
import './anniversary-visuals.css'

const DAY_MS = 86_400_000

/** A first occurrence has no previous yearly cycle, so it has no percentage. */
export function anniversaryCycleProgress(occurrence: AnniversaryOccurrence): number | null {
  if (!occurrence.entry.repeatsYearly || !occurrence.years) return null
  const [targetYear, targetMonth, targetDay] = occurrence.date.split('-').map(Number)
  const [, sourceMonth, sourceDay] = occurrence.entry.date.split('-').map(Number)
  const previousYear = targetYear - 1
  const lastDay = new Date(Date.UTC(previousYear, sourceMonth, 0)).getUTCDate()
  const previous = Date.UTC(previousYear, sourceMonth - 1, Math.min(sourceDay, lastDay))
  const target = Date.UTC(targetYear, targetMonth - 1, targetDay)
  const totalDays = Math.round((target - previous) / DAY_MS)
  if (totalDays <= 0) return null
  return Math.min(1, Math.max(0, (totalDays - occurrence.daysAway) / totalDays))
}

export function AnniversaryCountdown({ occurrence }: { occurrence: AnniversaryOccurrence }) {
  const progress = anniversaryCycleProgress(occurrence)
  const percent = progress === null ? null : Math.floor(progress * 100)
  const isToday = occurrence.daysAway === 0

  return (
    <div className={`anniversary-visual-countdown${isToday ? ' is-today' : ''}`}>
      <div className="anniversary-ring">
        <svg viewBox="0 0 200 200" role="img" aria-label={percent === null ? '等待特别的日子' : `本轮周年进度 ${percent}%`}>
          <circle className="anniversary-ring-orbit" cx="100" cy="100" r="96" />
          <circle className="anniversary-ring-track" cx="100" cy="100" r="82" />
          {progress === null ? null : (
            <circle
              className="anniversary-ring-progress"
              cx="100"
              cy="100"
              r="82"
              pathLength="100"
              strokeDasharray={`${progress * 100} 100`}
              transform="rotate(-90 100 100)"
            />
          )}
          <circle className="anniversary-ring-paper" cx="100" cy="100" r="69" />
        </svg>
        <div className="anniversary-ring-value">
          {isToday ? <Heart size={33} fill="currentColor" aria-hidden="true" /> : <strong>{occurrence.daysAway}</strong>}
          <span>{isToday ? '就是今天' : '天后见'}</span>
        </div>
      </div>
      <span className="anniversary-ring-caption">
        {percent === null ? '把期待，留给这一天' : `这一年的期待 · ${percent}%`}
      </span>
    </div>
  )
}

const confettiPieces = Array.from({ length: 12 }, (_, index) => index)

/** Kept inside the hero; replaying this never blocks or covers the page. */
export function AnniversaryCelebration({ isToday }: { isToday: boolean }) {
  const reducedMotion = useReducedMotion()
  const [burst, setBurst] = useState(isToday ? 1 : 0)
  const [lit, setLit] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
  }, [])

  function celebrate() {
    setBurst((current) => current + 1)
    setLit(true)
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setLit(false), 1600)
  }

  return (
    <>
      {burst > 0 && !reducedMotion ? (
        <div key={burst} className="anniversary-confetti" aria-hidden="true">
          {confettiPieces.map((index) => <i key={index} className={`anniversary-confetti-piece piece-${index}`} />)}
        </div>
      ) : null}
      <button className="anniversary-celebrate-button" type="button" onClick={celebrate}>
        <Sparkles size={15} aria-hidden="true" />
        <span aria-live="polite">{lit ? '愿美好如期而至' : isToday ? '一起庆祝' : '点亮期待'}</span>
      </button>
    </>
  )
}
