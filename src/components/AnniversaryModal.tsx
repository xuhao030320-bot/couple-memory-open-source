import {
  CakeSlice,
  CalendarHeart,
  Check,
  Heart,
  MapPinned,
  Plane,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnniversaryEntry, AnniversaryKind } from '../types'

interface AnniversaryModalProps {
  entry: AnniversaryEntry
  isNew: boolean
  onClose: () => void
  onSave: (entry: AnniversaryEntry) => Promise<void>
}

const kindOptions: Array<{
  id: AnniversaryKind
  label: string
  icon: typeof Heart
}> = [
  { id: 'love', label: '恋爱', icon: Heart },
  { id: 'birthday', label: '生日', icon: CakeSlice },
  { id: 'first', label: '第一次', icon: Sparkles },
  { id: 'trip', label: '旅行', icon: Plane },
  { id: 'custom', label: '特别日子', icon: MapPinned },
]

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function AnniversaryModal({
  entry,
  isNew,
  onClose,
  onSave,
}: AnniversaryModalProps) {
  const [draft, setDraft] = useState(entry)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const savingRef = useRef(saving)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0)

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!savingRef.current) {
          event.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true')

      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  async function submit() {
    const title = draft.title.trim()
    if (!title) {
      setError('给这个日子取一个名字吧')
      return
    }
    if (!draft.date) {
      setError('请选择日期')
      return
    }

    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await onSave({ ...draft, title, note: draft.note.trim() })
      savingRef.current = false
      onClose()
    } catch (reason) {
      savingRef.current = false
      setSaving(false)
      setError(reason instanceof Error ? reason.message : '纪念日保存失败')
    }
  }

  return (
    <div className="modal-backdrop anniversary-modal-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose() }}>
      <section
        ref={dialogRef}
        className="settings-modal anniversary-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anniversary-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">A DATE TO REMEMBER</span>
            <h2 id="anniversary-modal-title">{isNew ? '收藏一个特别日子' : '修改这个纪念日'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={20} /></button>
        </header>

        <form className="anniversary-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <label className="field-row">
            <span>纪念日名称</span>
            <input
              ref={titleRef}
              value={draft.title}
              maxLength={80}
              placeholder="例如：第一次一起看海"
              required
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>

          <div className="field-row anniversary-date-row">
            <label>
              <span>日期</span>
              <div className="date-input-wrap">
                <CalendarHeart size={17} />
                <input type="date" value={draft.date} required onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
              </div>
            </label>
            <label className="repeat-toggle">
              <input
                type="checkbox"
                checked={draft.repeatsYearly}
                onChange={(event) => setDraft({ ...draft, repeatsYearly: event.target.checked })}
              />
              <span aria-hidden="true"><i /></span>
              <strong>每年提醒</strong>
            </label>
          </div>

          <fieldset className="kind-picker">
            <legend>这个日子属于</legend>
            <div>
              {kindOptions.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={draft.kind === id ? 'is-active' : ''}
                  type="button"
                  aria-pressed={draft.kind === id}
                  onClick={() => setDraft({ ...draft, kind: id })}
                >
                  <Icon size={16} fill={id === 'love' && draft.kind === id ? 'currentColor' : 'none'} />
                  <span>{label}</span>
                  {draft.kind === id ? <Check size={13} /> : null}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field-row anniversary-note-field">
            <span>想记住的话 <small>{draft.note.length}/280</small></span>
            <textarea
              value={draft.note}
              maxLength={280}
              rows={3}
              placeholder="那天的天气、心情，或者一句只属于你们的话…"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <div className="modal-actions">
            <button className="button secondary" type="button" disabled={saving} onClick={onClose}>先不保存</button>
            <button className="button primary" type="submit" disabled={saving}>
              <Heart size={17} fill="currentColor" />{saving ? '正在收藏…' : isNew ? '收藏这个日子' : '保存修改'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
