import { ArrowRight, Eye, EyeOff, Heart, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { useState } from 'react'

const REMEMBER_EMAIL_KEY = 'only-us-remember-email'

function storedValue(key: string) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}

interface AuthViewProps {
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (displayName: string, email: string, password: string) => Promise<'signed-in' | 'verify-email'>
}

export function AuthView({ onLogin, onRegister }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState(() => storedValue(REMEMBER_EMAIL_KEY))
  const [password, setPassword] = useState('')
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(storedValue(REMEMBER_EMAIL_KEY)))
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit() {
    setError('')
    setNotice('')
    if (mode === 'register' && !displayName.trim()) {
      setError('请填写你希望对方看到的称呼')
      return
    }
    if (!email.trim() || password.length < 6) {
      setError('请填写有效邮箱，密码至少 6 位')
      return
    }

    setBusy(true)
    try {
      if (mode === 'login') {
        await onLogin(email.trim(), password)
        try {
          if (rememberEmail) localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim())
          else localStorage.removeItem(REMEMBER_EMAIL_KEY)
        } catch { /* 隐私模式下 localStorage 可能不可用，忽略 */ }
      } else {
        const result = await onRegister(displayName.trim(), email.trim(), password)
        if (result === 'verify-email') {
          setNotice('注册成功！请打开验证邮件，确认后再回来登录。')
          setMode('login')
          setPassword('')
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story-panel">
        <div className="auth-brand"><span><Heart size={20} fill="currentColor" /></span><div><strong>只此我们</strong><small>ONLY OURS</small></div></div>
        <div className="auth-story-copy">
          <span className="eyebrow">A PRIVATE PLACE FOR TWO</span>
          <h1>把共同生活，<br />慢慢写成一本书。</h1>
          <p>这里没有关注、排名和公开分享。只有两个账号，以及只属于你们的照片和日子。</p>
        </div>
        <div className="auth-polaroids" aria-hidden="true">
          <figure><img src="/moments/sunset.svg" alt="" /></figure>
          <figure><img src="/moments/flowers.svg" alt="" /></figure>
          <span>you & me</span>
        </div>
        <div className="auth-private-note"><LockKeyhole size={16} /><span>情侣空间使用独立账号和数据库权限保护</span></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-card">
          <span className="eyebrow">WELCOME HOME</span>
          <h2>{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h2>
          <p>{mode === 'login' ? '登录后继续书写你们的故事。' : '注册后可以创建空间，或者使用邀请码加入对方。'}</p>

          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); setNotice('') }}>登录</button>
            <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); setNotice('') }}>注册</button>
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
            {mode === 'register' && (
              <label className="auth-field"><span>你的称呼</span><div><UserRound size={17} /><input autoComplete="name" maxLength={20} value={displayName} placeholder="例如：小满" onChange={(event) => setDisplayName(event.target.value)} /></div></label>
            )}
            <label className="auth-field"><span>邮箱</span><div><Mail size={17} /><input type="email" autoComplete="email" value={email} placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} /></div></label>
            <label className="auth-field"><span>密码</span><div><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} placeholder="至少 6 位" onChange={(event) => setPassword(event.target.value)} /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>

            {error && <p className="auth-message error">{error}</p>}
            {notice && <p className="auth-message success">{notice}</p>}

            {mode === 'login' && (
              <div className="auth-remember">
                <label>
                  <input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} />
                  记住账号
                </label>
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <>{mode === 'login' ? '进入我们的空间' : '注册账号'}<ArrowRight size={17} /></>}
            </button>
          </form>

          <small className="auth-footnote">登录即表示你只会上传自己有权保存的照片和内容。</small>
        </div>
      </section>
    </main>
  )
}
