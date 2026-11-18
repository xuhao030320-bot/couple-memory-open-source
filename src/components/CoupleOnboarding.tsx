import { ArrowRight, CalendarDays, Copy, Heart, Link2, LoaderCircle, LogOut, Plus, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { daysFromToday } from '../lib/date'

interface CoupleOnboardingProps {
  defaultName: string
  email: string
  onCreate: (displayName: string, startDate: string) => Promise<void>
  onJoin: (displayName: string, inviteCode: string) => Promise<void>
  onSignOut: () => Promise<void>
}

export function CoupleOnboarding({ defaultName, email, onCreate, onJoin, onSignOut }: CoupleOnboardingProps) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [displayName, setDisplayName] = useState(defaultName)
  const [startDate, setStartDate] = useState(daysFromToday(-365))
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>) {
    setError('')
    if (!displayName.trim()) {
      setError('先填写你的称呼')
      return
    }
    setBusy(true)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <div className="auth-brand"><span><Heart size={20} fill="currentColor" /></span><div><strong>只此我们</strong><small>ONLY OURS</small></div></div>
        <button type="button" onClick={() => void onSignOut()}><LogOut size={16} />退出 {email}</button>
      </header>

      <section className="onboarding-card">
        <span className="eyebrow">ONE LAST STEP</span>
        <h1>{mode === 'choose' ? '你想从哪里开始？' : mode === 'create' ? '创建情侣空间' : '加入对方的空间'}</h1>
        <p>{mode === 'choose' ? '一个人创建空间，另一个人使用邀请码加入。每个空间最多两位成员。' : mode === 'create' ? '创建后会得到一个 8 位邀请码，把它发给对方即可。' : '输入对方发来的邀请码，你们的回忆会立刻汇合。'}</p>

        {mode === 'choose' ? (
          <div className="onboarding-choices">
            <button type="button" onClick={() => setMode('create')}><span><Plus size={22} /></span><div><strong>创建新空间</strong><small>我是第一个来到这里的人</small></div><ArrowRight size={18} /></button>
            <button type="button" onClick={() => setMode('join')}><span><Link2 size={22} /></span><div><strong>使用邀请码加入</strong><small>对方已经创建好了空间</small></div><ArrowRight size={18} /></button>
          </div>
        ) : (
          <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); void run(() => mode === 'create' ? onCreate(displayName, startDate) : onJoin(displayName, inviteCode)) }}>
            <label><span>你的称呼</span><div><UsersRound size={17} /><input value={displayName} maxLength={20} placeholder="对方会看到这个名字" onChange={(event) => setDisplayName(event.target.value)} /></div></label>
            {mode === 'create' ? (
              <label><span>你们故事开始的日期</span><div><CalendarDays size={17} /><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div></label>
            ) : (
              <label><span>8 位邀请码</span><div><Copy size={17} /><input className="invite-input" value={inviteCode} maxLength={8} placeholder="例如：A8K2M9QX" onChange={(event) => setInviteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></div></label>
            )}
            {error && <p className="auth-message error">{error}</p>}
            <div className="onboarding-actions"><button type="button" onClick={() => { setMode('choose'); setError('') }}>返回</button><button type="submit" disabled={busy || (mode === 'join' && inviteCode.length !== 8)}>{busy ? <LoaderCircle className="spin" size={18} /> : <>{mode === 'create' ? '创建空间' : '确认加入'}<ArrowRight size={17} /></>}</button></div>
          </form>
        )}
      </section>
    </main>
  )
}
