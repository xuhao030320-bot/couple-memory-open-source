import {
  Bot,
  Check,
  Circle,
  Cloud,
  Copy,
  Heart,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppView, CoupleProfile, MemoryEntry, WishCategory, WishItem } from '../types'
import { aiChat, aiSuggest, readAiSettings, writeAiSettings, type AiSettings } from '../lib/ai'
import { daysTogether, formatFullDate } from '../lib/date'
import { listCloudTrash, purgeCloudTrash, restoreCloudTrash, type CloudTrashItem } from '../lib/cloud-storage'

interface UsViewProps {
  profile: CoupleProfile
  memories: MemoryEntry[]
  wishes: WishItem[]
  inviteCode?: string
  cloudMode?: boolean
  accountEmail?: string
  coupleId?: string
  onSettings: () => void
  onWishesChange: (wishes: WishItem[]) => void
  onNavigate: (view: AppView) => void
  onSignOut?: () => Promise<void>
  onTrashRestored?: () => void
  onExport?: () => Promise<void>
  exportProgress?: string
  onToast?: (message: string) => void
}

const wishCategories: Array<{ id: WishCategory; label: string }> = [
  { id: 'long_term', label: '长期愿望' },
  { id: 'daily', label: '日常想做的事' },
  { id: 'food', label: '想吃的' },
]

const nextWishCategory: Record<WishCategory, WishCategory> = {
  long_term: 'daily',
  daily: 'food',
  food: 'long_term',
}

const wishCategoryLabel: Record<WishCategory, string> = {
  long_term: '长期',
  daily: '日常',
  food: '想吃',
}

const trashKindLabel: Record<CloudTrashItem['kind'], string> = {
  memory: '回忆',
  wish: '心愿',
  anniversary: '纪念日',
  message: '留言',
  partner_note: '备忘',
}

function trashRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function UsView({ profile, memories, wishes, inviteCode, cloudMode = false, accountEmail, coupleId, onSettings, onWishesChange, onNavigate, onSignOut, onTrashRestored, onToast, onExport, exportProgress }: UsViewProps) {
  const [newWish, setNewWish] = useState('')
  const [newWishCategory, setNewWishCategory] = useState<WishCategory>('long_term')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'done'>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | WishCategory>('all')
  const [copied, setCopied] = useState(false)
  const [trashItems, setTrashItems] = useState<CloudTrashItem[]>([])
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashError, setTrashError] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const trashScope = coupleId || 'local'
  const scopeRef = useRef(trashScope)
  scopeRef.current = trashScope
  const mountedRef = useRef(true)
  const trashRequestRef = useRef(0)
  const trashActionRef = useRef(false)
  const exportBusyRef = useRef(false)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; trashRequestRef.current++ } }, [])
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatRounds, setChatRounds] = useState<Array<{ question: string; answer: string }>>([])
  const [aiSettings, setAiSettings] = useState<AiSettings>(readAiSettings)
  const [dailyQuestion, setDailyQuestion] = useState('')
  const [dailyBusy, setDailyBusy] = useState(false)
  const photoCount = memories.reduce((sum, memory) => sum + memory.photos.length, 0)

  function todayKey() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  /** 每日一问：让 AI 判断今天值得问什么；结果按日期缓存在本机，每天只判断一次。 */
  async function refreshDailyQuestion() {
    if (!cloudMode || !coupleId || dailyBusy) return
    setDailyBusy(true)
    try {
      const question = await aiSuggest(coupleId)
      if (!question) return
      setDailyQuestion(question)
      try {
        window.localStorage.setItem('only-us-ai-daily-question', JSON.stringify({ date: todayKey(), question }))
      } catch {
        // 本机缓存写不进就算了
      }
    } catch {
      // 今天没想出来就不显示，不打扰用户
    } finally {
      setDailyBusy(false)
    }
  }

  // 进页面时先读今天的缓存；没有缓存才问一次 AI
  useEffect(() => {
    if (!cloudMode || !coupleId) return
    try {
      const cached = JSON.parse(window.localStorage.getItem('only-us-ai-daily-question') || 'null')
      if (cached && cached.date === todayKey() && typeof cached.question === 'string' && cached.question) {
        setDailyQuestion(cached.question)
        return
      }
    } catch {
      // 缓存损坏，直接重新生成
    }
    void refreshDailyQuestion()
  }, [cloudMode, coupleId])

  /** 回忆问答：把问题发给云端，成功追加一轮，失败只 toast、保留输入。 */
  async function sendChat() {
    const question = chatQuestion.trim()
    if (!question || chatBusy || !cloudMode || !coupleId) return
    setChatBusy(true)
    try {
      const answer = await aiChat(coupleId, question)
      setChatRounds((current) => [...current, { question, answer }].slice(-6))
      setChatQuestion('')
    } catch (reason) {
      onToast?.(reason instanceof Error ? reason.message : '回忆助手暂时走神了，请稍后再试')
    } finally {
      setChatBusy(false)
    }
  }

  async function reloadTrash() {
    const requestedScope = trashScope
    const request = ++trashRequestRef.current
    const current = () => mountedRef.current && scopeRef.current === requestedScope && trashRequestRef.current === request
    setTrashBusy(true)
    setTrashError('')
    try {
      const items = await listCloudTrash(requestedScope)
      if (current()) setTrashItems(items)
    } catch (error) {
      if (current()) setTrashError(error instanceof Error ? error.message : '回收站读取失败')
    } finally {
      if (current()) setTrashBusy(false)
    }
  }

  useEffect(() => {
    setTrashItems([])
    void reloadTrash()
    return () => { trashRequestRef.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashScope])

  async function restoreTrash(item: CloudTrashItem) {
    if (trashActionRef.current) return
    trashActionRef.current = true
    const requestedScope = trashScope
    const current = () => mountedRef.current && scopeRef.current === requestedScope
    setTrashBusy(true)
    try {
      await restoreCloudTrash(requestedScope, item.id)
      if (current()) { onTrashRestored?.(); await reloadTrash() }
    } catch (error) {
      if (current()) setTrashError(error instanceof Error ? error.message : '恢复失败')
    } finally {
      trashActionRef.current = false
      if (current()) setTrashBusy(false)
    }
  }

  async function purgeTrash(item: CloudTrashItem) {
    if (trashActionRef.current) return
    if (!window.confirm(`彻底删除「${item.title}」后无法恢复，确定吗？`)) return
    trashActionRef.current = true
    const requestedScope = trashScope
    const current = () => mountedRef.current && scopeRef.current === requestedScope
    setTrashBusy(true)
    try {
      await purgeCloudTrash(requestedScope, item.id)
      if (current()) await reloadTrash()
    } catch (error) {
      if (current()) setTrashError(error instanceof Error ? error.message : '彻底删除失败')
    } finally {
      trashActionRef.current = false
      if (current()) setTrashBusy(false)
    }
  }

  async function exportBackup() {
    if (!onExport || exportBusyRef.current) return
    exportBusyRef.current = true
    setExportBusy(true)
    const requestedScope = trashScope
    try { await onExport() }
    catch (error) { if (mountedRef.current && scopeRef.current === requestedScope) onToast?.(error instanceof Error ? error.message : '备份导出失败，请重试') }
    finally { exportBusyRef.current = false; if (mountedRef.current) setExportBusy(false) }
  }

  const visibleWishes = wishes.filter((wish) => (
    (statusFilter === 'all' || (statusFilter === 'active') === !wish.completed)
    && (categoryFilter === 'all' || wish.category === categoryFilter)
  ))

  function addWish() {
    const value = newWish.trim()
    if (!value) return
    onWishesChange([...wishes, {
      id: crypto.randomUUID(),
      text: value,
      completed: false,
      // 保留用户选择的分类；“想吃”条目应继续显示在“想吃”列表中。
      category: newWishCategory,
      createdAt: new Date().toISOString(),
    }])
    setNewWish('')
  }

  return (
    <div className="page us-page">
      <header className="page-topbar">
        <div><span className="eyebrow">JUST THE TWO OF US</span><h1>关于我们</h1><p>共同拥有的过去，也包括正在期待的未来。</p></div>
        <div className="page-actions"><button className="round-action" type="button" aria-label="打开设置" onClick={onSettings}><Settings size={20} /></button>{onSignOut && <button className="round-action" type="button" aria-label="退出登录" onClick={() => void onSignOut()}><LogOut size={19} /></button>}</div>
      </header>

      <section className="couple-profile-card">
        <div className="profile-ornament ornament-one" aria-hidden="true">✦</div>
        <div className="profile-ornament ornament-two" aria-hidden="true">♡</div>
        <div className="large-avatar-pair"><span>{profile.personA.slice(0, 1)}</span><i><Heart size={18} fill="currentColor" /></i><span>{profile.personB.slice(0, 1)}</span></div>
        <span className="eyebrow">OUR STORY BEGAN</span>
        <h2>{profile.personA} & {profile.personB}</h2>
        <p>{formatFullDate(profile.startDate)} · 至今 {daysTogether(profile.startDate)} 天</p>
        <button className="text-link light" type="button" onClick={onSettings}>修改资料 <Settings size={14} /></button>
      </section>

      <section className="us-stats">
        <div><strong>{daysTogether(profile.startDate)}</strong><span>一起走过的天数</span></div>
        <div><strong>{memories.length}</strong><span>被保存的故事</span></div>
        <div><strong>{photoCount}</strong><span>收藏的照片</span></div>
      </section>

      {cloudMode && coupleId && (
        <section className="ai-chat-card">
          <div className="section-heading"><div><span className="eyebrow">MEMORY ASSISTANT</span><h2>回忆助手</h2></div><span className="chat-badge"><Bot size={14} />只答我们的手账</span></div>
          <p className="ai-chat-desc">问它任何关于你们回忆的问题，它会翻一翻两个人的手账再回答。</p>
          {dailyQuestion && (
            <div className="ai-daily-row">
              <button type="button" className="ai-daily-question" onClick={() => setChatQuestion(dailyQuestion)}>
                <Sparkles size={13} />今天可以问：{dailyQuestion}
              </button>
              <button type="button" className="ai-daily-refresh" aria-label="换一个问题" disabled={dailyBusy} onClick={() => void refreshDailyQuestion()}>
                <RefreshCw size={13} className={dailyBusy ? 'spin' : ''} />
              </button>
            </div>
          )}
          <div className="ai-chat-bubbles">
            {chatRounds.length === 0 && !chatBusy && (
              <p className="ai-chat-empty">{dailyQuestion ? '点上面的「今天可以问」试试，或直接输入你想问的。' : '试试问：「我们第一次去旅行是什么时候？」'}</p>
            )}
            {chatRounds.map((round, index) => (
              <div className="ai-chat-round" key={index}>
                <div className="ai-chat-bubble is-question">{round.question}</div>
                <div className="ai-chat-bubble is-answer">{round.answer}</div>
              </div>
            ))}
            {chatBusy && <div className="ai-chat-bubble is-answer is-thinking">正在翻我们的手账…</div>}
          </div>
          <form className="ai-chat-input-row" onSubmit={(event) => { event.preventDefault(); void sendChat() }}>
            <input value={chatQuestion} maxLength={200} placeholder="问问我们的回忆…" onChange={(event) => setChatQuestion(event.target.value)} />
            <button type="submit" aria-label="发送问题" disabled={chatBusy || !chatQuestion.trim()}>
              {chatBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
            </button>
          </form>
        </section>
      )}

      <div className="us-grid">
        <section className="wish-card">
          <div className="section-heading"><div><span className="eyebrow">OUR WISH LIST</span><h2>想和你一起</h2></div><span className="count-badge">{wishes.filter((wish) => wish.completed).length}/{wishes.length}</span></div>
          <div className="wish-filters">
            <div className="filter-pills" role="group" aria-label="愿望状态">
              {[{ id: 'all', label: '全部' }, { id: 'active', label: '进行中' }, { id: 'done', label: '已完成' }].map((item) => (
                <button key={item.id} type="button" aria-pressed={statusFilter === item.id} className={statusFilter === item.id ? 'is-active' : ''} onClick={() => setStatusFilter(item.id as typeof statusFilter)}>{item.label}</button>
              ))}
            </div>
            <div className="filter-pills" role="group" aria-label="愿望类型">
              {[{ id: 'all', label: '全部' }, ...wishCategories].map((item) => (
                 <button key={item.id} type="button" aria-pressed={categoryFilter === item.id} className={categoryFilter === item.id ? 'is-active' : ''} onClick={() => { setCategoryFilter(item.id as typeof categoryFilter); setNewWishCategory(item.id === 'all' ? 'long_term' : item.id as WishCategory) }}>{item.label}</button>
              ))}
            </div>
          </div>
           <form className="wish-input" onSubmit={(event) => { event.preventDefault(); addWish() }}>
            <input value={newWish} maxLength={80} placeholder="写下一个共同愿望…" onChange={(event) => setNewWish(event.target.value)} />
            <button type="submit" aria-label="添加愿望"><Plus size={18} /></button>
          </form>
          <div className="wish-list">
            {visibleWishes.map((wish) => (
              <div className={`wish-item ${wish.completed ? 'is-completed' : ''}`} key={wish.id}>
                <button type="button" aria-label={wish.completed ? '标记为未完成' : '标记为已完成'} onClick={() => onWishesChange(wishes.map((item) => item.id === wish.id ? { ...item, completed: !item.completed } : item))}>
                  {wish.completed ? <Check size={15} /> : <Circle size={17} />}
                </button>
                <div className="wish-item-copy">
                  <button
                    className={`wish-category-tag ${wish.category === 'long_term' ? 'is-long-term' : wish.category === 'daily' ? 'is-daily' : 'is-food'}`}
                    type="button"
                    aria-label="切换分类"
                    onClick={() => onWishesChange(wishes.map((item) => item.id === wish.id ? { ...item, category: nextWishCategory[wish.category] } : item))}
                  >
                    {wishCategoryLabel[wish.category] || '长期'}
                  </button>
                  <span className="wish-item-text">{wish.text}</span>
                </div>
                <button className="wish-delete" type="button" aria-label="删除愿望" onClick={() => onWishesChange(wishes.filter((item) => item.id !== wish.id))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          {visibleWishes.length === 0 ? (
            <div className="wish-empty">
              <Sparkles size={24} aria-hidden="true" />
              <strong>{wishes.length === 0 ? '写下第一件想一起做的事' : '这里暂时没有愿望'}</strong>
              <p>{wishes.length === 0 ? '不必等特别的日子，从一个小愿望开始。' : '换个分类，看看其他想一起做的事。'}</p>
            </div>
          ) : null}
        </section>

        <div className="us-side-stack">
          {(
            <section className="trash-card">
              <div className="trash-card-heading"><div className="capsule-icon"><Trash2 size={22} /></div><span>回收站</span><small>保留 30 天</small></div>
              <p>删除的回忆、心愿、纪念日、留言和备忘会先放在这里，30 天内可以恢复。</p>
              {trashBusy && !trashItems.length && <p className="trash-message">读取中…</p>}
              {trashError && <p className="trash-message is-error">{trashError}</p>}
              {!trashBusy && !trashError && trashItems.length === 0 && <p className="trash-message">回收站是空的</p>}
              {trashItems.length > 0 && (
                <div className="trash-list">
                  {trashItems.map((item) => (
                    <div className="trash-item" key={item.id}>
                      <div className="trash-item-copy">
                        <span className="trash-kind">{trashKindLabel[item.kind] || item.kind}</span>
                        <span className="trash-title">{item.title}</span>
                        <span className="trash-when">{trashRelativeTime(item.deletedAt)}删除</span>
                      </div>
                      <div className="trash-actions">
                        <button type="button" disabled={trashBusy} onClick={() => void restoreTrash(item)}>恢复</button>
                        <button type="button" className="is-danger" disabled={trashBusy} onClick={() => void purgeTrash(item)}>彻底删除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {onExport && <section className="privacy-card"><Send size={22} aria-hidden="true" /><div><h3>导出空间备份</h3><p>包含当前可见回忆的照片、视频与文字、留言、备忘、纪念日和愿望。</p><button className="button secondary" type="button" disabled={exportBusy} onClick={() => void exportBackup()}>{exportBusy ? (exportProgress || '正在整理备份…') : '导出空间备份'}</button></div></section>}
          {cloudMode && inviteCode && (
            <section className="invite-card">
              <div className="invite-card-heading"><div className="capsule-icon"><Cloud size={22} /></div><span>邀请另一半</span></div>
              <p>对方注册后输入这个邀请码，即可加入共同空间。</p>
              <button type="button" onClick={async () => { await navigator.clipboard.writeText(inviteCode); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }}><strong>{inviteCode}</strong><span><Copy size={15} />{copied ? '已复制' : '复制'}</span></button>
              {accountEmail && <small>当前账号：{accountEmail}</small>}
            </section>
          )}
          <section className="capsule-card">
            <div className="capsule-icon"><Mail size={22} /></div>
            <span className="eyebrow">MESSAGE WALL</span>
            <h2>留言墙</h2>
            <p>把想说的话留在这里，选择什么时候让对方看见。未到点的留言会锁起来。</p>
            <button className="capsule-seal" type="button" onClick={() => onNavigate('messages')}><Heart size={15} fill="currentColor" /> 去留言</button>
          </section>

          <section className="privacy-card">
            <LockKeyhole size={22} />
            <div><h3>私人空间</h3><p>{cloudMode ? '数据已保存到你们的云端空间，并由成员权限保护。照片不会公开展示。' : '当前数据仅保存在这个浏览器。没有账号、没有公开分享，也没有模型读取照片。'}</p></div>
          </section>

          <section className="ai-settings-card">
            <div className="ai-settings-heading"><Sparkles size={18} /><span>AI 设置</span></div>
            <div className="ai-settings-group">
              <span className="ai-settings-label">模型</span>
              <div className="ai-settings-pills">
                <button type="button" className={aiSettings.model === 'flash' ? 'is-active' : ''} onClick={() => { const next = { ...aiSettings, model: 'flash' as const }; setAiSettings(next); writeAiSettings(next) }}>V4 Flash · 快</button>
                <button type="button" className={aiSettings.model === 'pro' ? 'is-active' : ''} onClick={() => { const next = { ...aiSettings, model: 'pro' as const }; setAiSettings(next); writeAiSettings(next) }}>V4 Pro · 强</button>
              </div>
            </div>
            <div className="ai-settings-group">
              <span className="ai-settings-label">推理强度</span>
              <div className="ai-settings-pills">
                {([['low', '保守'], ['high', '大胆'], ['xhigh', '天马行空']] as const).map(([value, label]) => (
                  <button key={value} type="button" className={aiSettings.strength === value ? 'is-active' : ''} onClick={() => { const next = { ...aiSettings, strength: value }; setAiSettings(next); writeAiSettings(next) }}>{label}</button>
                ))}
              </div>
            </div>
            <p className="ai-settings-note">Flash 便宜快速，Pro 更强更稳；推理强度越高越爱琢磨（也越慢越贵）。设置保存在本机。</p>
          </section>
        </div>
      </div>
    </div>
  )
}
