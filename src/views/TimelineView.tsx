import {
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Heart,
  ListTree,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutPreview } from '../components/LayoutPreview'
import { MemoryMap } from '../components/MemoryMap'
import { PhotoLightbox } from '../components/PhotoLightbox'
import {
  inferMemoryCategory,
  MEMORY_CATEGORIES,
} from '../features/memories/memory'
import { aiSearch, type AiSearchResult } from '../lib/ai'
import { buildMonthGrid, WEEKDAY_LABELS } from '../lib/calendar'
import { formatFullDate } from '../lib/date'
import type { MemoryCategory, MemoryEntry } from '../types'

interface TimelineViewProps {
  memories: MemoryEntry[]
  onCompose: () => void
  onEdit: (memory: MemoryEntry, reroll?: boolean) => void
  onDelete: (id: string) => Promise<void>
  onToggleLike: (memory: MemoryEntry) => void
  /** 云端情侣空间 ID；为空时隐藏 AI 搜索入口。 */
  coupleId?: string
  onToast?: (message: string) => void
}

type FilterValue = 'all' | MemoryCategory | 'liked'
type ViewMode = 'timeline' | 'month'

const filters: Array<{ id: FilterValue; label: string }> = [
  { id: 'all', label: '全部' },
  ...MEMORY_CATEGORIES.map(({ id, label }) => ({ id, label })),
  { id: 'liked', label: '喜欢' },
]

const TIMELINE_PREFERENCES_KEY = 'only-us-timeline-preferences'

interface TimelinePreferences {
  query: string
  filter: FilterValue
  viewMode: ViewMode
}

function readTimelinePreferences(): TimelinePreferences {
  const fallback: TimelinePreferences = { query: '', filter: 'all', viewMode: 'timeline' }
  try {
    const raw = sessionStorage.getItem(TIMELINE_PREFERENCES_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<TimelinePreferences>
    const validFilter = filters.some((item) => item.id === parsed.filter)
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      filter: validFilter ? parsed.filter as FilterValue : 'all',
      viewMode: parsed.viewMode === 'month' ? 'month' : 'timeline',
    }
  } catch {
    return fallback
  }
}

function MemoryActions({
  memory,
  onEdit,
  onDelete,
  onToggleLike,
}: Pick<TimelineViewProps, 'onEdit' | 'onDelete' | 'onToggleLike'> & { memory: MemoryEntry }) {
  return (
    <div className="memory-entry-actions">
      <button
        type="button"
        aria-label={memory.isLiked ? `取消喜欢 ${memory.title}` : `喜欢 ${memory.title}`}
        title={memory.isLiked ? '取消喜欢' : '喜欢'}
        className={memory.isLiked ? 'is-liked' : ''}
        aria-pressed={memory.isLiked === true}
        onClick={() => onToggleLike(memory)}
      ><Heart size={16} fill={memory.isLiked ? 'currentColor' : 'none'} /></button>
      <button type="button" aria-label={`编辑 ${memory.title}`} title="编辑" onClick={() => onEdit(memory)}><Pencil size={16} /></button>
      <button type="button" aria-label={`重新排版 ${memory.title}`} title="重新排版" onClick={() => onEdit(memory, true)}><Sparkles size={16} /></button>
      <button
        className="danger"
        type="button"
        aria-label={`删除 ${memory.title}`}
        title="删除"
        onClick={async () => {
          if (window.confirm(`把“${memory.title}”移到回收站吗？30 天内可以在“我们”里恢复。`)) await onDelete(memory.id)
        }}
      ><Trash2 size={16} /></button>
    </div>
  )
}

const MemoryStory = memo(function MemoryStory({ memory, compact = false, onPhotoClick }: {
  memory: MemoryEntry
  compact?: boolean
  onPhotoClick?: (index: number) => void
}) {
  return (
    <>
      <LayoutPreview
        title={memory.title}
        text={memory.displayText}
        date={memory.date}
        location={memory.location}
        style={memory.style}
        template={memory.template}
        photos={memory.photos}
        tags={memory.tags}
        moodEmoji={memory.moodEmoji}
        moodText={memory.moodText}
        compact={compact}
        themeColor={memory.themeColor}
        onPhotoClick={onPhotoClick}
      />
      <MemoryMap latitude={memory.latitude} longitude={memory.longitude} location={memory.location} compact />
    </>
  )
})

const MAX_CALENDAR_EMOJIS = 3

function MemoryCalendar({
  memories,
  onEdit,
  onDelete,
  onToggleLike,
  onJumpToDate,
  onOpenLightbox,
}: Pick<TimelineViewProps, 'onEdit' | 'onDelete' | 'onToggleLike'> & {
  memories: MemoryEntry[]
  onJumpToDate: (date: string) => void
  onOpenLightbox: (memory: MemoryEntry, index: number) => void
}) {
  const newestDate = memories[0]?.date
  const initialCursor = newestDate
    ? { year: Number(newestDate.slice(0, 4)), month: Number(newestDate.slice(5, 7)) }
    : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
  const [cursor, setCursor] = useState(initialCursor)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 选中日期后把展开面板滚进视野（日历较长时面板会落在屏幕外）
  useEffect(() => {
    if (selectedDate) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedDate])

  const byDate = useMemo(() => {
    const map = new Map<string, MemoryEntry[]>()
    for (const memory of memories) {
      const list = map.get(memory.date)
      if (list) list.push(memory)
      else map.set(memory.date, [memory])
    }
    return map
  }, [memories])

  const weeks = buildMonthGrid(cursor.year, cursor.month)
  const selectedMemories = selectedDate ? byDate.get(selectedDate) || [] : []

  function moveMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(current.year, current.month - 1 + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() + 1 }
    })
  }

  return (
    <div className="memory-calendar">
      <div className="calendar-nav">
        <button className="nav-arrow" type="button" aria-label="上个月" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button>
        <h3 onClick={() => setCursor(initialCursor)}>{cursor.year}年{cursor.month}月</h3>
        <button className="nav-arrow" type="button" aria-label="下个月" onClick={() => moveMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="calendar-grid">
        {weeks.flat().map((day) => {
          const dayMemories = byDate.get(day.date) || []
          return (
            <button
              className={`calendar-day ${day.inMonth && dayMemories.length ? 'has-memories' : ''} ${day.isToday ? 'is-today' : ''} ${!day.inMonth ? 'is-outside' : ''} ${selectedDate === day.date ? 'is-selected' : ''}`}
              type="button"
              key={day.date}
              disabled={!day.inMonth}
              onClick={() => setSelectedDate((current) => current === day.date ? null : day.date)}
            >
              <span className="calendar-day-number">{day.day}</span>
              <span className="calendar-day-moods">
                {dayMemories.slice(0, MAX_CALENDAR_EMOJIS).map((memory) => <i key={memory.id}>{memory.moodEmoji || '💭'}</i>)}
                {dayMemories.length > MAX_CALENDAR_EMOJIS && <em>+{dayMemories.length - MAX_CALENDAR_EMOJIS}</em>}
              </span>
            </button>
          )
        })}
      </div>
      {selectedDate && (
        <div className="calendar-day-memories" ref={panelRef}>
          <header>
            <div><span className="eyebrow">ON THIS DAY</span><h3>{formatFullDate(selectedDate)}</h3></div>
            <span className="count-badge">{selectedMemories.length} 篇</span>
            <button className="text-link" type="button" onClick={() => onJumpToDate(selectedDate)}>在时间线中查看 <ChevronRight size={14} /></button>
          </header>
          {selectedMemories.length ? (
            <div className="calendar-day-list">
              {selectedMemories.map((memory) => (
                <article className="timeline-entry" key={memory.id}>
                  <div className="timeline-entry-content">
                    <header className="entry-toolbar">
                      <div>
                        <span>{formatFullDate(memory.date)}</span>
                        {memory.location && <span><MapPin size={13} />{memory.location}</span>}
                        <span className="category-badge">{MEMORY_CATEGORIES.find((item) => item.id === memory.category)?.label || '日常'}</span>
                        {memory.isDemo && <span className="demo-badge">示例内容</span>}
                      </div>
                      <MemoryActions memory={memory} onEdit={onEdit} onDelete={onDelete} onToggleLike={onToggleLike} />
                    </header>
                    <MemoryStory memory={memory} onPhotoClick={(index) => onOpenLightbox(memory, index)} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="calendar-day-empty">这天没有符合当前筛选的回忆。</p>
          )}
        </div>
      )}
    </div>
  )
}

export function TimelineView({ memories, onCompose, onEdit, onDelete, onToggleLike, coupleId, onToast }: TimelineViewProps) {
  const [preferences, setPreferences] = useState(readTimelinePreferences)
  const { query, filter, viewMode } = preferences
  const deferredQuery = useDeferredValue(query)
  const pendingScrollDateRef = useRef<string | null>(null)
  const pendingScrollMemoryRef = useRef<string | null>(null)
  const [lightbox, setLightbox] = useState<{ memory: MemoryEntry; index: number } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null)
  const [highlightedMemoryId, setHighlightedMemoryId] = useState('')

  // 从日历「在时间线中查看」跳转：切回时间线视图、重置筛选并定位到该日期第一篇
  function handleJumpToDate(date: string) {
    setPreferences((current) => ({ ...current, viewMode: 'timeline', filter: 'all', query: '' }))
    pendingScrollDateRef.current = date
  }

  // AI 搜索命中跳转：普通关键词筛选可能匹配不到模糊命中的回忆，先清掉筛选再定位
  function jumpToMemory(memoryId: string) {
    setPreferences((current) => ({ ...current, viewMode: 'timeline', filter: 'all', query: '' }))
    pendingScrollMemoryRef.current = memoryId
  }

  useEffect(() => {
    const target = pendingScrollDateRef.current
    if (!target || viewMode !== 'timeline') return
    const entry = document.querySelector(`[data-date="${target}"]`)
    if (entry) {
      entry.scrollIntoView({ behavior: 'smooth', block: 'start' })
      pendingScrollDateRef.current = null
    }
  }, [viewMode, deferredQuery, filter, memories])

  useEffect(() => {
    const target = pendingScrollMemoryRef.current
    if (!target || viewMode !== 'timeline') return
    const entry = document.querySelector(`[data-memory-id="${target}"]`)
    if (entry) {
      entry.scrollIntoView({ behavior: 'smooth', block: 'start' })
      pendingScrollMemoryRef.current = null
      setHighlightedMemoryId(target)
      const timer = window.setTimeout(() => setHighlightedMemoryId(''), 2600)
      return () => window.clearTimeout(timer)
    }
  }, [viewMode, deferredQuery, filter, memories])

  // 关键词变化后旧结果不再可靠，清掉避免误导
  useEffect(() => {
    setAiResult(null)
  }, [query])

  /** AI 搜索：理解模糊描述并从回忆里挑相关条目。 */
  async function runAiSearch() {
    if (!coupleId || aiBusy) return
    const searchQuery = query.trim()
    if (!searchQuery) return
    setAiBusy(true)
    try {
      setAiResult(await aiSearch(coupleId, searchQuery))
    } catch (reason) {
      onToast?.(reason instanceof Error ? reason.message : 'AI 搜索暂时不可用，请稍后再试')
    } finally {
      setAiBusy(false)
    }
  }

  useEffect(() => {
    try {
      sessionStorage.setItem(TIMELINE_PREFERENCES_KEY, JSON.stringify(preferences))
    } catch {
      // Browsing still works when private-mode storage is unavailable.
    }
  }, [preferences])

  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    return memories
      .filter((memory) => {
        const matchesFilter = filter === 'all'
          || (filter === 'liked' ? Boolean(memory.isLiked) : inferMemoryCategory(memory) === filter)
        const haystack = `${memory.title} ${memory.displayText} ${memory.location} ${memory.moodText} ${memory.tags.join(' ')}`.toLowerCase()
        return matchesFilter && (!normalized || haystack.includes(normalized))
      })
      .sort((left, right) => (
        right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)
      ))
  }, [deferredQuery, filter, memories])

  return (
    <div className="page timeline-page">
      <header className="page-topbar timeline-topbar">
        <div><span className="eyebrow">OUR ARCHIVE</span><h1>回忆时间线</h1><p>按时间慢慢翻，也可以按月看看我们走过的日子。</p></div>
        <button className="button primary" type="button" onClick={onCompose}><Plus size={18} />写一篇</button>
      </header>

      <div className="timeline-tools">
        <label className="search-box"><Search size={18} /><input aria-label="搜索回忆" value={query} onChange={(event) => setPreferences((current) => ({ ...current, query: event.target.value }))} placeholder="搜索文字、地点、心情或标签" /></label>
        {coupleId && (
          <button className="ai-search-button" type="button" disabled={aiBusy || !query.trim()} onClick={() => void runAiSearch()}>
            {aiBusy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}AI 搜索
          </button>
        )}
        <div className="timeline-tool-groups">
          <div className="filter-pills" role="group" aria-label="回忆分类">
            {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setPreferences((current) => ({ ...current, filter: item.id }))}>{item.label}</button>)}
          </div>
          <div className="view-switcher" role="group" aria-label="回忆排列方式">
            <button type="button" aria-pressed={viewMode === 'timeline'} className={viewMode === 'timeline' ? 'is-active' : ''} onClick={() => setPreferences((current) => ({ ...current, viewMode: 'timeline' }))}><ListTree size={16} />时间线</button>
            <button type="button" aria-pressed={viewMode === 'month'} className={viewMode === 'month' ? 'is-active' : ''} onClick={() => setPreferences((current) => ({ ...current, viewMode: 'month' }))}><CalendarDays size={16} />日历</button>
          </div>
        </div>
      </div>

      {aiResult && (
        <section className="ai-search-results">
          <p className="ai-search-reply"><Sparkles size={14} />{aiResult.reply}</p>
          {aiResult.matches.length > 0 && (
            <div className="ai-search-match-list">
              {aiResult.matches.map((match) => (
                <button key={match.memoryId || match.title} type="button" className="ai-search-match" onClick={() => jumpToMemory(match.memoryId)}>
                  <span className="ai-search-match-title">{match.title || '未命名回忆'}</span>
                  <span className="ai-search-match-meta">{formatFullDate(match.date)}{match.location ? ` · ${match.location}` : ''}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {filtered.length ? (
        viewMode === 'timeline' ? (
          <div className="timeline-list">
            {filtered.map((memory, index) => (
              <article
                className={`timeline-entry ${highlightedMemoryId === memory.id ? 'is-ai-highlighted' : ''}`}
                data-date={memory.date}
                data-memory-id={memory.id}
                key={memory.id}
              >
                <div className="timeline-marker"><span>{new Date(`${memory.date}T00:00:00`).getDate()}</span><small>{new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(new Date(`${memory.date}T00:00:00`))}</small></div>
                <div className="timeline-line" aria-hidden="true" />
                <div className="timeline-entry-content">
                  <header className="entry-toolbar">
                    <div>
                      <span>{formatFullDate(memory.date)}</span>
                      {memory.location && <span><MapPin size={13} />{memory.location}</span>}
                      <span className="category-badge">{MEMORY_CATEGORIES.find((item) => item.id === memory.category)?.label || '日常'}</span>
                      {memory.isDemo && <span className="demo-badge">示例内容</span>}
                    </div>
                    <MemoryActions memory={memory} onEdit={onEdit} onDelete={onDelete} onToggleLike={onToggleLike} />
                  </header>
                  <MemoryStory memory={memory} onPhotoClick={(photoIndex) => setLightbox({ memory, index: photoIndex })} />
                  {index === 0 && memory.isDemo && <p className="demo-hint">这是用于展示排版效果的示例。你可以编辑它，也可以在添加自己的第一篇记录后删除。</p>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <MemoryCalendar memories={filtered} onEdit={onEdit} onDelete={onDelete} onToggleLike={onToggleLike} onJumpToDate={handleJumpToDate} onOpenLightbox={(memory, index) => setLightbox({ memory, index })} />
        )
      ) : (
        <div className="empty-state"><Camera size={34} /><h2>还没有找到这段回忆</h2><p>换个关键词或分类，或者现在写下一篇新的记录。</p><div className="empty-state-actions">
          {coupleId && query.trim() && (
            <button className="button secondary" type="button" disabled={aiBusy} onClick={() => void runAiSearch()}>
              {aiBusy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}试试 AI 搜索
            </button>
          )}
          <button className="button primary" type="button" onClick={onCompose}><Plus size={17} />新建记录</button>
        </div></div>
      )}

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.memory.photos}
          index={lightbox.index}
          onNavigate={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
