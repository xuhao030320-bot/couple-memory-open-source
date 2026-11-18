import {
  ArrowRight,
  CalendarHeart,
  Camera,
  ChevronRight,
  Heart,
  PenLine,
  Settings,
  Sparkles,
} from 'lucide-react'
import {
  formatMilestoneCountdown,
  getUpcomingAnniversaries,
  relationshipAnniversary,
} from '../features/anniversaries/anniversary'
import { lazy, Suspense } from 'react'
import { homeAlbumVersion } from '../features/memories/home-album'
import { MediaAssetView } from '../components/MediaAssetView'
import { StoryGrowth } from '../components/StoryGrowth'
import { daysTogether, formatMemoryDate } from '../lib/date'
import type { AnniversaryEntry, AppView, CoupleProfile, MemoryEntry } from '../types'

const HomeAlbum = lazy(() => import('../components/HomeAlbum'))

interface HomeViewProps {
  profile: CoupleProfile
  /** 当前登录用户的昵称（本地模式 = personA；云端模式 = 自己在空间里的名字）。 */
  myName: string
  memories: MemoryEntry[]
  anniversaries: AnniversaryEntry[]
  onNavigate: (view: AppView) => void
  onSettings: () => void
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 11) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function HomeView({ profile, myName, memories, anniversaries, onNavigate, onSettings }: HomeViewProps) {
  const together = daysTogether(profile.startDate)
  const nextAnniversary = getUpcomingAnniversaries([
    relationshipAnniversary(profile),
    ...anniversaries,
  ])[0]
  const totalMedia = memories.reduce((sum, memory) => sum + memory.photos.length, 0)
  const photos = memories.flatMap((memory) => memory.photos)
  const milestoneProgress = nextAnniversary && nextAnniversary.years !== null
    ? Math.min(1, Math.max(0, 1 - nextAnniversary.daysAway / 365))
    : null

  return (
    <div className="page home-page home-page--compact">
      <header className="page-topbar">
        <div>
          <span className="eyebrow">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</span>
          <h1>{greeting()}，{myName}</h1>
          <p>把今天过好，也把今天留下来。</p>
        </div>
        <button className="round-action" type="button" aria-label="打开设置" onClick={onSettings}><Settings size={20} /></button>
      </header>

      <section className="days-hero">
        <div className="home-hero-doodles" aria-hidden="true"><span className="hero-doodle-star" /><svg viewBox="0 0 190 120" fill="none"><path d="M8 106C38 99 33 65 64 69S108 93 124 56 165 27 182 10" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 7" strokeLinecap="round" /><path d="m173 12 10-4-3 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /><path d="M85 83c-11-9-18-18-11-23 5-4 10 0 11 4 2-5 8-7 12-3 7 6-2 15-12 22Z" fill="currentColor" fillOpacity=".4" /></svg></div>
        <div className="hero-copy">
          <span className="hero-kicker"><Heart size={14} fill="currentColor" /> SINCE {profile.startDate.replaceAll('-', '.')}</span>
          <p className="hero-small">{profile.personA} 与 {profile.personB} 的故事</p>
          <div className="days-line"><strong>{together}</strong><span>天</span></div>
          <h2>在一起的每一天，<br />都是故事的正文。</h2>
          <button className="text-link light" type="button" onClick={() => onNavigate('memories')}>翻看我们的回忆 <ArrowRight size={16} /></button>
        </div>
        <Suspense fallback={<div className="hero-collage" aria-label="相册加载中"><div className="book-shell"><div className="pageflip-host"><div className="pageflip-loading" aria-hidden="true" /></div></div></div>}>
          <HomeAlbum key={homeAlbumVersion(photos)} photos={photos} onCompose={() => onNavigate('compose')} />
        </Suspense>
      </section>

      <div className="home-grid">
        <div className="home-primary-stack">
          <button className="quick-record-card" type="button" onClick={() => onNavigate('compose')}>
            <div className="quick-record-icon"><PenLine size={22} /></div>
            <div><span className="eyebrow">WRITE IT DOWN</span><h3>今天想留下些什么？</h3><p>几句话，或几张照片就好。</p></div>
            <span className="quick-arrow"><ArrowRight size={18} /></span>
          </button>
          <section className="content-section recent-section">
            <div className="section-heading">
              <div><span className="eyebrow">RECENT STORIES</span><h2>最近的回忆</h2></div>
              <button className="text-link" type="button" onClick={() => onNavigate('memories')}>查看全部 <ChevronRight size={16} /></button>
            </div>
            <div className="recent-list">
              {memories.length === 0 && (
                <div className="home-empty-stories">
                  <PenLine size={25} aria-hidden="true" />
                  <div><h3>第一篇回忆，留给今天</h3><p>几句话，一张照片，就能留住这一刻。</p></div>
                  <button className="button secondary" type="button" onClick={() => onNavigate('compose')}>记录第一篇 <ArrowRight size={16} /></button>
                </div>
              )}
              {memories.slice(0, 2).map((memory) => (
                <button className="recent-card" type="button" key={memory.id} onClick={() => onNavigate('memories')}>
                  <div className="recent-thumb">
                    {memory.photos[0] ? <MediaAssetView asset={memory.photos[0]} controls={false} muted /> : <Camera size={25} />}
                    {memory.isDemo && <span>示例</span>}
                  </div>
                  <div className="recent-card-copy">
                    <span>{formatMemoryDate(memory.date)} {memory.location && ` · ${memory.location}`}</span>
                    <h3>{memory.title}</h3>
                    <p>{memory.displayText}</p>
                    <span className="recent-mood">{memory.moodEmoji || '💭'} {memory.moodText || '未记录心情'}</span>
                    <div>{memory.tags.slice(0, 2).map((tag) => <small key={tag}>#{tag}</small>)}</div>
                  </div>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          </section>

        </div>
        <aside className="home-side-stack">
          <section className={`milestone-card${nextAnniversary?.daysAway === 0 ? ' is-today' : ''}`}>
            <div className="milestone-icon"><CalendarHeart size={22} /></div>
            <div>
              <span className="eyebrow">NEXT SWEET DATE</span>
              <h3>{nextAnniversary?.entry.title || '下一个重要日子'}</h3>
              <div className="milestone-count">
                <strong>{nextAnniversary ? (nextAnniversary.daysAway === 0 ? '今天' : nextAnniversary.daysAway) : '—'}</strong>
                {nextAnniversary && nextAnniversary.daysAway > 0 && <span>天</span>}
              </div>
              <p className="milestone-subline">{nextAnniversary ? formatMilestoneCountdown(nextAnniversary.daysAway, nextAnniversary.years) : '去收藏一个值得期待的日子'}</p>
              {milestoneProgress !== null && (
                <div className="milestone-progress" role="progressbar" aria-valuenow={Math.round(milestoneProgress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="距离下一个纪念日的进度">
                  <i style={{ width: `${Math.round(milestoneProgress * 100)}%` }} />
                </div>
              )}
            </div>
            <button type="button" onClick={() => onNavigate('anniversaries')}>查看全部</button>
          </section>

          <StoryGrowth memories={memories} totalMedia={totalMedia} />

          <div className="local-tip"><Sparkles size={16} /><span>平凡的今天，也值得被认真收藏。</span></div>
        </aside>
      </div>
    </div>
  )
}
