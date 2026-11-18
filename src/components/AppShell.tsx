import {
  BookHeart,
  CalendarHeart,
  CirclePlus,
  Cloud,
  Heart,
  HeartHandshake,
  House,
  Images,
  LockKeyhole,
  Mail,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AppView, CoupleProfile } from '../types'

interface AppShellProps {
  activeView: AppView
  profile: CoupleProfile
  cloudMode?: boolean
  children: ReactNode
  onNavigate: (view: AppView) => void
}

const navItems: Array<{
  id: AppView
  label: string
  icon: typeof House
}> = [
  { id: 'home', label: '今天', icon: House },
  { id: 'memories', label: '回忆', icon: Images },
  { id: 'compose', label: '记录', icon: CirclePlus },
  { id: 'anniversaries', label: '纪念日', icon: CalendarHeart },
  { id: 'messages', label: '留言', icon: Mail },
  { id: 'us', label: '我们', icon: HeartHandshake },
]

export function AppShell({ activeView, profile, cloudMode = false, children, onNavigate }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="side-panel" aria-label="主要导航">
        <button className="brand" type="button" onClick={() => onNavigate('home')}>
          <span className="brand-mark"><Heart size={19} fill="currentColor" /></span>
          <span>
            <strong>只此我们</strong>
            <small>ONLY OURS</small>
          </span>
        </button>

        <nav className="side-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeView === id ? 'is-active' : ''}`}
              type="button"
              aria-current={activeView === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={20} strokeWidth={1.8} />
              <span>{label}</span>
              {id === 'compose' && <span className="nav-shortcut">+</span>}
            </button>
          ))}
        </nav>

        <div className="side-couple-card">
          <div className="avatar-pair" aria-hidden="true">
            <span>{profile.personA.slice(0, 1)}</span>
            <span>{profile.personB.slice(0, 1)}</span>
          </div>
          <div>
            <strong>{profile.personA} & {profile.personB}</strong>
            <small>{cloudMode ? <Cloud size={12} /> : <LockKeyhole size={12} />} {cloudMode ? '双人云端同步' : '仅当前设备可见'}</small>
          </div>
        </div>

        <div className="side-note">
          <BookHeart size={18} />
          <p>愿每一个寻常日子，后来都有迹可循。</p>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isCompose = id === 'compose'
          return (
            <button
              key={id}
              className={`${activeView === id ? 'is-active' : ''} ${isCompose ? 'mobile-compose' : ''}`}
              type="button"
              aria-current={activeView === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              <span className="mobile-nav-icon"><Icon size={isCompose ? 24 : 21} strokeWidth={1.9} /></span>
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
