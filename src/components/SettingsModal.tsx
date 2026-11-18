import { LockKeyhole, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CoupleProfile } from '../types'

interface SettingsModalProps {
  open: boolean
  profile: CoupleProfile
  editablePerson?: 'A' | 'B' | 'both'
  onClose: () => void
  onSave: (profile: CoupleProfile) => void | Promise<void>
}

export function SettingsModal({ open, profile, editablePerson = 'both', onClose, onSave }: SettingsModalProps) {
  const [draft, setDraft] = useState(profile)

  useEffect(() => setDraft(profile), [profile, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div><span className="eyebrow">OUR PROFILE</span><h2 id="settings-title">设置我们的信息</h2></div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><X size={20} /></button>
        </header>

        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault()
            void onSave(draft)
          }}
        >
          <div className="field-row two-columns">
            <label><span>{editablePerson === 'B' ? '对方的称呼' : '你的称呼'}</span><input value={draft.personA} disabled={editablePerson === 'B'} maxLength={12} onChange={(event) => setDraft({ ...draft, personA: event.target.value })} required /></label>
            <label><span>{editablePerson === 'B' ? '你的称呼' : '对方的称呼'}</span><input value={draft.personB} disabled={editablePerson === 'A'} maxLength={12} onChange={(event) => setDraft({ ...draft, personB: event.target.value })} required /></label>
          </div>
          <label className="field-row"><span>故事开始的日期</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} required /></label>

          <div className="privacy-callout">
            <LockKeyhole size={20} />
            <p><strong>{editablePerson === 'both' ? '当前是本地优先版本' : '称呼与故事日期会同步'}</strong><span>{editablePerson === 'both' ? '资料、文字和照片只保存在这个浏览器中，还不会跨设备同步。纪念日请到独立页面管理。' : '你只能修改自己的称呼；对方的称呼需要由对方账号修改。其他特别日子请到纪念日页面管理。'}</span></p>
          </div>

          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onClose}>取消</button>
            <button className="button primary" type="submit"><Save size={17} />保存设置</button>
          </div>
        </form>
      </section>
    </div>
  )
}
