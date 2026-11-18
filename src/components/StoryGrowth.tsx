import { useEffect, useId, useRef, useState } from 'react'
import { Heart, Sprout } from 'lucide-react'
import { monthlyMemoryActivity } from '../features/memories/monthly-activity'
import type { MemoryEntry } from '../types'
import './story-growth.css'

interface StoryGrowthProps {
  memories: MemoryEntry[]
  totalMedia: number
}

export function StoryGrowth({ memories, totalMedia }: StoryGrowthProps) {
  const months = monthlyMemoryActivity(memories)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const gradientId = useId().replaceAll(':', '')
  const headingId = useId()
  const selected = months.find(({ key }) => key === selectedKey)
  const recentCount = months.reduce((sum, { count }) => sum + count, 0)
  const maximum = Math.max(1, ...months.map(({ count }) => count))
  const points = months.map((month, index) => ({
    ...month,
    x: 24 + index * 48,
    y: 84 - (month.count / maximum) * 62,
  }))
  const line = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`
    const previous = points[index - 1]
    const middle = (previous.x + point.x) / 2
    return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`
  }, '')
  const chartDescription = months.map(({ year, month, count }) => `${year}年${month}月${count}篇`).join('，')

  useEffect(() => {
    const element = cardRef.current
    if (!element || !('IntersectionObserver' in window)) {
      setRevealed(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setRevealed(true)
      observer.disconnect()
    }, { threshold: .2 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={cardRef} className={`story-growth-card${revealed ? ' is-revealed' : ''}`} aria-labelledby={headingId}>
      <div className="story-growth-heading">
        <div><span className="eyebrow">LITTLE BY LITTLE</span><h3 id={headingId}><Sprout size={17} aria-hidden="true" />故事在生长</h3></div>
        <span className="story-growth-period">近六个月</span>
      </div>
      <p className="story-growth-intro">{recentCount ? <>把 <strong>{recentCount}</strong> 个日常，写成了我们的故事。</> : '从一篇回忆开始，让故事慢慢生长。'}</p>
      <div className="story-growth-plot" role="img" aria-label={`按回忆日期统计：${chartDescription}。示例回忆不计入。`}>
        <div className="story-growth-guides" aria-hidden="true"><i /><i /><i /></div>
        <div className="story-growth-drawing">
          <svg viewBox="0 0 288 108" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <defs><linearGradient id={gradientId} x1="0" y1="20" x2="0" y2="96" gradientUnits="userSpaceOnUse"><stop stopColor="#c66a78" stopOpacity=".19" /><stop offset="1" stopColor="#c66a78" stopOpacity="0" /></linearGradient></defs>
            {recentCount > 0 && <path d={`${line} L 264 100 L 24 100 Z`} fill={`url(#${gradientId})`} />}
            <path d={line} stroke={recentCount ? '#b96675' : '#c8c3b7'} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={recentCount ? undefined : '3 6'} />
            {points.map((point) => (
              <g key={point.key}>
                {selected?.key === point.key && <circle cx={point.x} cy={point.y} r="10" fill="#f4dce0" />}
                <circle cx={point.x} cy={point.y} r={point.count ? 4.5 : 3.5} fill={point.count ? '#bc6978' : '#fffaf3'} stroke={point.count ? '#fffaf3' : '#c7c0b2'} strokeWidth="2" />
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div className="story-growth-months" role="group" aria-label="查看每月回忆篇数">
        {months.map((month) => <button key={month.key} type="button" aria-pressed={selected?.key === month.key} aria-label={`${month.year}年${month.month}月，${month.count}篇回忆`} onClick={() => setSelectedKey(selected?.key === month.key ? null : month.key)}><span>{month.month}月</span><i aria-hidden="true" /></button>)}
      </div>
      <p className="story-growth-caption" aria-live="polite"><Heart size={12} aria-hidden="true" />{selected ? `${selected.year} 年 ${selected.month} 月 · ${selected.count} 篇回忆` : recentCount ? '轻点月份，看看那时的我们' : '每个平凡的日子，都值得留下'}</p>
      <dl className="story-growth-totals">
        <div><dt>篇回忆</dt><dd>{memories.length}</dd></div>
        <div><dt>份媒体</dt><dd>{totalMedia}</dd></div>
        <div><dt>个标签</dt><dd>{new Set(memories.flatMap((memory) => memory.tags)).size}</dd></div>
      </dl>
    </section>
  )
}
