import {
  CakeSlice,
  CalendarHeart,
  Check,
  Copy,
  Heart,
  LoaderCircle,
  MapPinned,
  Pencil,
  Plane,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { AnniversaryModal } from '../components/AnniversaryModal'
import { AnniversaryCelebration, AnniversaryCountdown } from '../components/AnniversaryCountdown'
import {
  daysElapsedSince,
  formatAnniversaryCountdown,
  getAnniversaryOccurrence,
  getUpcomingAnniversaries,
  relationshipAnniversary,
} from '../features/anniversaries/anniversary'
import { aiBlessing } from '../lib/ai'
import { daysTogether, formatFullDate, toISODate } from '../lib/date'
import type { AnniversaryEntry, AnniversaryKind, CoupleProfile } from '../types'

interface AnniversariesViewProps {
  profile: CoupleProfile
  anniversaries: AnniversaryEntry[]
  onCreate: (entry: AnniversaryEntry) => Promise<void>
  onUpdate: (entry: AnniversaryEntry) => Promise<void>
  onDelete: (entry: AnniversaryEntry) => Promise<void>
  onSettings: () => void
  /** 云端模式才展示 AI 入口。 */
  cloudMode?: boolean
  coupleId?: string
  onToast?: (message: string) => void
}

type EditorState = {
  entry: AnniversaryEntry
  isNew: boolean
} | null

const kindMeta: Record<AnniversaryKind, {
  label: string
  icon: typeof Heart
}> = {
  love: { label: '恋爱', icon: Heart },
  birthday: { label: '生日', icon: CakeSlice },
  first: { label: '第一次', icon: Sparkles },
  trip: { label: '旅行', icon: Plane },
  custom: { label: '特别日子', icon: MapPinned },
}

function newAnniversary(): AnniversaryEntry {
  return {
    id: crypto.randomUUID(),
    title: '',
    date: toISODate(new Date()),
    repeatsYearly: true,
    kind: 'custom',
    note: '',
    createdAt: new Date().toISOString(),
  }
}

function AnniversaryCard({
  entry,
  onEdit,
  onDelete,
  onSettings,
}: {
  entry: AnniversaryEntry
  onEdit: (entry: AnniversaryEntry) => void
  onDelete: (entry: AnniversaryEntry) => void
  onSettings: () => void
}) {
  const occurrence = getAnniversaryOccurrence(entry)
  const meta = kindMeta[entry.kind]
  const Icon = meta.icon
  const date = new Date(`${entry.date}T00:00:00`)
  const month = new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(date)
  const day = String(date.getDate()).padStart(2, '0')

  const elapsed = daysElapsedSince(entry.date)
  const isToday = elapsed === 0
  const mainLabel = elapsed < 0 && occurrence
    ? formatAnniversaryCountdown(occurrence.daysAway)
    : isToday
      ? '就是今天'
      : `到今天 ${elapsed + 1} 天`

  return (
    <article className={`anniversary-card kind-${entry.kind} ${entry.isSystem ? 'is-system' : ''}`}>
      <div className="anniversary-date-stamp" aria-hidden="true"><span>{month}</span><strong>{day}</strong></div>
      <div className="anniversary-card-copy">
        <div className="anniversary-card-meta">
          <span><Icon size={13} fill={entry.kind === 'love' ? 'currentColor' : 'none'} />{entry.isSystem ? '我们的起点' : meta.label}</span>
          <span>{entry.repeatsYearly ? '每年' : '仅一次'}</span>
        </div>
        <h3>{entry.title}</h3>
        <time dateTime={entry.date}>{formatFullDate(entry.date)}</time>
        {entry.note ? <p>{entry.note}</p> : null}
      </div>
      <div className="anniversary-card-side">
        <div className="anniversary-timing">
          <strong className={isToday ? 'is-today' : ''}>{mainLabel}</strong>
          {entry.repeatsYearly && occurrence && (
            <small className="anniversary-next-note">下次 · {formatAnniversaryCountdown(occurrence.daysAway)}</small>
          )}
        </div>
        <div className="anniversary-card-actions">
          <button
            type="button"
            aria-label={entry.isSystem ? '修改故事开始日期' : `编辑${entry.title}`}
            onClick={entry.isSystem ? onSettings : () => onEdit(entry)}
          >
            {entry.isSystem ? <Settings size={16} /> : <Pencil size={16} />}
          </button>
          {!entry.isSystem ? (
            <button className="danger" type="button" aria-label={`删除${entry.title}`} onClick={() => onDelete(entry)}>
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function AnniversariesView({
  profile,
  anniversaries,
  onCreate,
  onUpdate,
  onDelete,
  onSettings,
  cloudMode = false,
  coupleId,
  onToast,
}: AnniversariesViewProps) {
  const [editor, setEditor] = useState<EditorState>(null)
  const [blessing, setBlessing] = useState('')
  const [blessingBusy, setBlessingBusy] = useState(false)
  const [blessingCopied, setBlessingCopied] = useState(false)
  const entries = useMemo(
    () => [relationshipAnniversary(profile), ...anniversaries],
    [anniversaries, profile],
  )
  const upcoming = useMemo(() => getUpcomingAnniversaries(entries), [entries])
  const next = upcoming[0]
  const orderedEntries = useMemo(() => {
    const upcomingIds = new Map(upcoming.map((item, index) => [item.entry.id, index]))
    return [...entries].sort((a, b) => {
      const aIndex = upcomingIds.get(a.id)
      const bIndex = upcomingIds.get(b.id)
      if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex
      if (aIndex !== undefined) return -1
      if (bIndex !== undefined) return 1
      return b.date.localeCompare(a.date)
    })
  }, [entries, upcoming])

  async function confirmDelete(entry: AnniversaryEntry) {
    if (!window.confirm(`要删除“${entry.title}”吗？这个操作会同步到两个人的设备。`)) return
    await onDelete(entry)
  }

  /** 纪念文案：给 hero 里最近的那个日子写一段祝福。 */
  async function generateBlessing() {
    if (!cloudMode || !coupleId || blessingBusy) return
    setBlessingBusy(true)
    try {
      const blessingText = await aiBlessing(coupleId, {
        occasionTitle: next?.entry.title || '我们的纪念日',
        names: [profile.personA, profile.personB],
        daysTogether: daysTogether(profile.startDate),
      })
      setBlessing(blessingText)
    } catch (reason) {
      onToast?.(reason instanceof Error ? reason.message : '祝福生成失败，请稍后再试')
    } finally {
      setBlessingBusy(false)
    }
  }

  async function copyBlessing() {
    if (!blessing) return
    try {
      await navigator.clipboard.writeText(blessing)
      setBlessingCopied(true)
      window.setTimeout(() => setBlessingCopied(false), 1800)
    } catch {
      onToast?.('复制失败，请手动长按选择复制')
    }
  }

  return (
    <div className="page anniversaries-page anniversaries-page--visual">
      <header className="page-topbar anniversaries-topbar">
        <div>
          <span className="eyebrow">OUR SWEET DATES</span>
          <h1>纪念日</h1>
          <p>有些日子因为一起经历过，就变得闪闪发光。</p>
        </div>
        <button className="button primary anniversary-add-button" type="button" onClick={() => setEditor({ entry: newAnniversary(), isNew: true })}>
          <Plus size={17} />添加纪念日
        </button>
      </header>

      {next ? (
        <section className={`next-anniversary-hero anniversary-visual-hero kind-${next.entry.kind}`}>
          <div className="anniversary-hero-orbit orbit-one" aria-hidden="true">♡</div>
          <div className="anniversary-hero-orbit orbit-two" aria-hidden="true">✦</div>
          <div className="next-anniversary-copy">
            <span className="hero-kicker"><CalendarHeart size={15} /> NEXT SWEET DATE</span>
            <p>下一件值得期待的小事</p>
            <h2>{next.entry.title}</h2>
            <time dateTime={next.date}>{formatFullDate(next.date)}</time>
            {next.years && next.years > 0 ? <small>{next.daysAway === 0 ? `已经一起走过 ${next.years} 年` : `即将迎来第 ${next.years} 年`}</small> : null}
            <div className="anniversary-hero-tools">
              <AnniversaryCelebration key={`${next.entry.id}:${next.date}`} isToday={next.daysAway === 0} />
              {cloudMode && coupleId ? (
                <button className="blessing-button" type="button" disabled={blessingBusy} onClick={() => void generateBlessing()}>
                  {blessingBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}生成祝福
                </button>
              ) : null}
            </div>
          </div>
          <AnniversaryCountdown occurrence={next} />
        </section>
      ) : null}

      {blessing && (
        <section className="blessing-result-card">
          <div className="blessing-result-copy">
            <span className="eyebrow">FOR YOU TWO</span>
            <p>{blessing}</p>
          </div>
          <button type="button" onClick={() => void copyBlessing()}>
            {blessingCopied ? <Check size={14} /> : <Copy size={14} />}{blessingCopied ? '已复制' : '复制'}
          </button>
        </section>
      )}

      <section className="anniversary-list-section">
        <div className="section-heading">
          <div><span className="eyebrow">ALL THE DATES</span><h2>收藏的日子</h2></div>
          <span className="count-badge">{entries.length} 个</span>
        </div>

        <div className="anniversary-list">
          {orderedEntries.map((entry) => (
            <AnniversaryCard
              key={entry.id}
              entry={entry}
              onEdit={(selected) => setEditor({ entry: selected, isNew: false })}
              onDelete={(selected) => void confirmDelete(selected)}
              onSettings={onSettings}
            />
          ))}
        </div>

        {anniversaries.length === 0 ? (
          <button className="anniversary-empty-prompt" type="button" onClick={() => setEditor({ entry: newAnniversary(), isNew: true })}>
            <span><Sparkles size={20} /></span>
            <div><strong>再收藏一个特别日子</strong><small>生日、第一次旅行，或任何只有你们懂的日期。</small></div>
            <Plus size={18} />
          </button>
        ) : null}
      </section>

      {editor ? (
        <AnniversaryModal
          entry={editor.entry}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSave={editor.isNew ? onCreate : onUpdate}
        />
      ) : null}
    </div>
  )
}
