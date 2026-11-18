import { CheckCircle2, ChevronUp, Heart, Leaf, LoaderCircle, Pencil, Pin, PinOff, Plus, Search, Send, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  clearPartnerNotesDraft,
  clearSavedPartnerNotesDraft,
  createNoteEditorState,
  emptyNoteInput,
  formatPartnerNoteTime,
  filterPartnerNotes,
  groupPartnerNotesByDate,
  isNoteDraftDirty,
  orderPartnerNotesNewestFirst,
  PARTNER_NOTES_PAGE_SIZE,
  readPartnerNotesDraft,
  sameNoteInput,
  writePartnerNotesDraft,
  type PartnerNoteDraft,
  type PartnerNoteFilter,
} from '../features/messages/partner-notes'
import type { PartnerNote, PartnerNoteInput } from '../types'

interface PartnerNotesProps {
  notes: PartnerNote[]
  scope: string
  myUserId?: string
  onCreate: (input: PartnerNoteInput) => Promise<void>
  onUpdate: (id: string, input: PartnerNoteInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onTogglePin: (id: string, pinned: boolean) => Promise<void>
}

const categories = [
  { kind: 'like', title: '喜欢', icon: Heart },
  { kind: 'care', title: '需要留意', icon: Leaf },
] as const

// 情侣空间和账号变化时分别恢复各自的单条草稿。
export function PartnerNotes(props: PartnerNotesProps) {
  return <PartnerNotesEditor key={props.scope} {...props} />
}

function PartnerNotesEditor({ notes, scope, myUserId, onCreate, onUpdate, onDelete, onTogglePin }: PartnerNotesProps) {
  const [editor, setEditor] = useState(() => createNoteEditorState(notes, readPartnerNotesDraft(scope)))
  const [composeOpen, setComposeOpen] = useState(() => editor.restored || editor.editingId !== null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PartnerNoteFilter>('all')
  const [visibleCount, setVisibleCount] = useState(PARTNER_NOTES_PAGE_SIZE)
  const [busy, setBusy] = useState<'save' | 'delete' | 'pin' | null>(null)
  const [pinningId, setPinningId] = useState<string | null>(null)
  const [pinError, setPinError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const inFlight = useRef(false)
  const draftDismissed = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusRequested = useRef(false)
  const headingId = useId()
  const orderedNotes = useMemo(() => orderPartnerNotesNewestFirst(notes), [notes])
  const matchingNotes = useMemo(() => filterPartnerNotes(orderedNotes, search, filter), [orderedNotes, search, filter])
  const visibleGroups = useMemo(() => groupPartnerNotesByDate(matchingNotes.slice(0, visibleCount)), [matchingNotes, visibleCount])
  const target = editor.editingId ? notes.find((note) => note.id === editor.editingId) : undefined
  const missingTarget = editor.editingId !== null && !target
  const editing = editor.editingId !== null && !missingTarget
  const remoteUpdated = target !== undefined && !sameNoteInput(target, editor.baseline)
  const dirty = isNoteDraftDirty(editor)
  const tooLong = editor.input.text.length > 1000
  const canSave = !!editor.input.text.trim() && !tooLong && (dirty || missingTarget)

  useEffect(() => {
    if (!composeOpen || !focusRequested.current) return
    focusRequested.current = false
    textareaRef.current?.focus({ preventScroll: true })
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    textareaRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  }, [composeOpen, editor.editingId])

  useEffect(() => {
    if (draftDismissed.current) return
    if (!isNoteDraftDirty(editor)) {
      clearPartnerNotesDraft(scope)
      return
    }
    writePartnerNotesDraft(scope, {
      input: editor.input,
      baseline: editor.baseline,
      editingId: editor.editingId,
    })
  }, [scope, editor.input, editor.baseline, editor.editingId])

  function changeInput(change: Partial<PartnerNoteInput>) {
    draftDismissed.current = false
    setEditor((current) => ({ ...current, input: { ...current.input, ...change } }))
    setError('')
    setSuccess('')
  }

  function resetEditor() {
    if (inFlight.current) return
    draftDismissed.current = true
    clearPartnerNotesDraft(scope)
    setEditor(createNoteEditorState(notes))
    setComposeOpen(false)
    setError('')
    setSuccess('')
  }

  function editNote(note: PartnerNote) {
    if (inFlight.current || editor.editingId === note.id) return
    if (dirty && !window.confirm('当前备忘还未保存，要放下这份草稿并编辑这条备忘吗？')) return
    draftDismissed.current = false
    const input = { text: note.text, kind: note.kind }
    focusRequested.current = true
    setComposeOpen(true)
    setEditor({ input, baseline: { ...input }, editingId: note.id, restored: false })
    setError('')
    setSuccess('')
    setDeleteId(null)
    setDeleteError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !canSave) return
    if (remoteUpdated && target && !sameNoteInput(editor.input, target) && !window.confirm('这条备忘已有新的修改。确定用当前输入替换最新内容吗？')) return
    const submittedDraft: PartnerNoteDraft = {
      input: { ...editor.input },
      baseline: { ...editor.baseline },
      editingId: editor.editingId,
    }
    const submitted = { ...editor.input, text: editor.input.text.trim() }
    inFlight.current = true
    setBusy('save')
    setError('')
    setSuccess('')
    try {
      if (editing && editor.editingId) await onUpdate(editor.editingId, submitted)
      else await onCreate(submitted)
      // 旧页面的请求返回时，不能清掉同空间新页面里继续写的草稿。
      clearSavedPartnerNotesDraft(scope, submittedDraft)
      draftDismissed.current = true
      setEditor({ input: emptyNoteInput(), baseline: emptyNoteInput(), editingId: null, restored: false })
      setComposeOpen(false)
      setSearch('')
      setFilter('all')
      setVisibleCount(PARTNER_NOTES_PAGE_SIZE)
      setSuccess(editing ? '修改已保存，原发布时间已保留。' : '备忘已发布。')
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : '请稍后再试。'
      setError(`${editing ? '保存' : '发布'}没成功，输入的内容还在。${detail}`)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function togglePin(note: PartnerNote) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('pin')
    setPinningId(note.id)
    setPinError('')
    setSuccess('')
    try {
      await onTogglePin(note.id, note.pinned !== true)
      setSuccess(note.pinned ? '已取消置顶。' : '已置顶，两个人都能看到。')
    } catch (reason) {
      setPinError(reason instanceof Error ? reason.message : '置顶没成功，请稍后重试。')
    } finally {
      inFlight.current = false
      setBusy(null)
      setPinningId(null)
    }
  }

  function clearFilters() {
    setSearch('')
    setFilter('all')
    setVisibleCount(PARTNER_NOTES_PAGE_SIZE)
  }

  async function deleteNote(id: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('delete')
    setDeleteError('')
    setSuccess('')
    try {
      await onDelete(id)
      setDeleteId(null)
      setSuccess('这条备忘已删除。')
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : '请稍后再试。'
      setDeleteError(`删除没成功，这条备忘还在。${detail}`)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  return (
    <section className="partner-notes-card" aria-labelledby={headingId}>
      <div className="partner-notes-heading">
        <div>
          <span className="eyebrow">PARTNER NOTES</span>
          <h2 id={headingId}>对方的喜好备忘</h2>
          <p className="partner-notes-intro">把在意的小事一条条记下来，下次见面就用得上。</p>
        </div>
        {notes.length > 0 && <span className="partner-notes-count">{notes.length} 条备忘</span>}
      </div>

      <div className="partner-notes-toolbar">
        <label className="partner-notes-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索备忘" value={search} placeholder="找一道菜、一个小习惯…" onChange={(event) => { setSearch(event.target.value); setVisibleCount(PARTNER_NOTES_PAGE_SIZE) }} /></label>
        <button className="button secondary partner-notes-compose-toggle" type="button" disabled={busy !== null} aria-expanded={composeOpen} aria-controls={`${headingId}-compose`} onClick={() => {
          if (!composeOpen) focusRequested.current = true
          setComposeOpen((open) => !open)
        }}>{composeOpen ? <ChevronUp size={16} /> : <Plus size={16} />}{composeOpen ? '收起编辑' : '写一条备忘'}</button>
      </div>
      <div className="partner-notes-filters filter-pills" role="group" aria-label="筛选备忘类别">
        {([{ kind: 'all', title: '全部' }, ...categories] as const).map(({ kind, title }) => (
          <button key={kind} type="button" aria-pressed={filter === kind} className={filter === kind ? 'is-active' : ''} onClick={() => { setFilter(kind); setVisibleCount(PARTNER_NOTES_PAGE_SIZE) }}>{title}</button>
        ))}
      </div>

      <div id={`${headingId}-compose`} className="partner-notes-compose-shell" hidden={!composeOpen}>
        <form className={`partner-notes-compose is-${editor.input.kind}`} onSubmit={save} aria-busy={busy === 'save'}>
          <div className="partner-notes-compose-heading">
            <label htmlFor={`${headingId}-text`}>{editing ? '编辑这条备忘' : '写一条备忘'}</label>
            <div className="partner-notes-category-picker" role="group" aria-label="备忘类别">
              {categories.map(({ kind, title, icon: Icon }) => (
                <button key={kind} type="button" aria-pressed={editor.input.kind === kind} disabled={busy !== null} onClick={() => changeInput({ kind })}>
                  <Icon size={15} />{title}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            id={`${headingId}-text`}
            aria-label="备忘内容"
            value={editor.input.text}
            maxLength={1000}
            rows={4}
            disabled={busy !== null}
            placeholder={editor.input.kind === 'like' ? '比如：喜欢草莓蛋糕，下次见面带一块。' : '比如：不吃香菜，点餐时记得说一声。'}
            onChange={(event) => changeInput({ text: event.target.value })}
          />
          <div className="partner-notes-compose-footer">
            <span className={`partner-notes-character-count ${tooLong ? 'is-over-limit' : ''}`}>{editor.input.text.length} / 1000</span>
            <div className="partner-notes-actions">
              {(editor.editingId !== null || editor.input.text.length > 0) && (
                <button className="button ghost" type="button" disabled={busy !== null} onClick={resetEditor}>{editor.editingId !== null ? '取消编辑' : '清空'}</button>
              )}
              <button className="button primary" type="submit" disabled={busy !== null || !canSave}>
                {busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                {busy === 'save' ? editing ? '保存中…' : '发布中…' : error ? editing ? '重试保存' : '重试发布' : editing ? '保存修改' : missingTarget ? '发布为新备忘' : '发布备忘'}
              </button>
            </div>
          </div>
          <p className="partner-notes-edit-hint">每次发布是一条备忘，换行也会保留在同一条里。</p>
          {editor.restored && <p className="partner-notes-status is-restored" role="status">{editing ? '已恢复上次未保存的修改。' : '已恢复上次未发布的备忘。'}</p>}
          {remoteUpdated && <p className="partner-notes-status is-update" role="status">这条备忘有新的修改，你输入的内容已保留。保存前会再次确认。</p>}
          {missingTarget && <p className="partner-notes-status is-update" role="status">这条备忘已删除，输入的内容可以作为新备忘发布。</p>}
          {tooLong && <p className="partner-notes-status is-error" role="alert">这条备忘超过 1000 字，请缩短后发布。原内容已保留。</p>}
          {error && <p className="partner-notes-status is-error" role="alert">{error}</p>}
        </form>
      </div>
      {success && <p className="partner-notes-status is-success" role="status"><CheckCircle2 size={17} />{success}</p>}
      {pinError && <p className="partner-notes-status is-error" role="alert">{pinError}</p>}

      {matchingNotes.length > 0 ? (
        <div className="partner-notes-list" aria-label="已发布的备忘">
          {visibleGroups.map((group) => (
            <section className={`partner-notes-date-group ${group.pinned ? 'is-pinned' : ''}`} key={group.key} aria-label={group.label}>
              <h3 className="partner-notes-date-heading">{group.pinned && <Pin size={13} aria-hidden="true" />}{group.label}</h3>
              {group.notes.map((note) => {
                const Icon = note.kind === 'like' ? Heart : Leaf
                const hasTime = note.createdAt !== null && !Number.isNaN(new Date(note.createdAt).getTime())
                return (
                  <article className={`partner-notes-entry is-${note.kind} ${note.pinned ? 'is-pinned' : ''} ${editor.editingId === note.id ? 'is-being-edited' : ''}`} key={note.id}>
                    <div className="partner-notes-entry-meta">
                      <span className="partner-notes-badge"><Icon size={14} />{note.kind === 'like' ? '喜欢' : '需要留意'}</span>
                      {note.createdBy && myUserId && <span className="partner-notes-author">{note.createdBy === myUserId ? '我' : '对方'}</span>}
                      {hasTime && note.createdAt ? <time dateTime={note.createdAt}>{formatPartnerNoteTime(note.createdAt)}</time> : <span className="partner-notes-legacy-time">{formatPartnerNoteTime(null)}</span>}
                    </div>
                    <p className="partner-notes-entry-text">{note.text}</p>
                    <div className="partner-notes-entry-actions">
                      <button className="partner-notes-pin-button" type="button" aria-pressed={note.pinned === true} disabled={busy !== null} onClick={() => void togglePin(note)}>{busy === 'pin' && pinningId === note.id ? <LoaderCircle className="spin" size={14} /> : note.pinned ? <PinOff size={14} /> : <Pin size={14} />}{note.pinned ? '取消置顶' : '置顶'}</button>
                      <button type="button" disabled={busy !== null || editor.editingId === note.id} onClick={() => editNote(note)}><Pencil size={14} />{editor.editingId === note.id ? '正在编辑' : '编辑'}</button>
                      <button type="button" disabled={busy !== null} onClick={() => { setDeleteId(note.id); setDeleteError('') }}><Trash2 size={14} />删除</button>
                    </div>
                    {deleteId === note.id && (
                      <div className="partner-notes-delete-confirm">
                        <p>删除这条备忘？</p>
                        <div>
                          <button type="button" disabled={busy !== null} onClick={() => { setDeleteId(null); setDeleteError('') }}>保留</button>
                          <button className="is-destructive" type="button" disabled={busy !== null} onClick={() => void deleteNote(note.id)}>{busy === 'delete' ? '删除中…' : deleteError ? '重试删除' : '确认删除'}</button>
                        </div>
                        {deleteError && <p className="partner-notes-status is-error" role="alert">{deleteError}</p>}
                      </div>
                    )}
                  </article>
                )
              })}
            </section>
          ))}
          {matchingNotes.length > visibleCount && <button className="button ghost partner-notes-load-more" type="button" onClick={() => setVisibleCount((count) => count + PARTNER_NOTES_PAGE_SIZE)}>再看 {Math.min(PARTNER_NOTES_PAGE_SIZE, matchingNotes.length - visibleCount)} 条 · 还有 {matchingNotes.length - visibleCount} 条</button>}
        </div>
      ) : notes.length > 0 ? (
        <div className="partner-notes-filter-empty"><Search size={22} aria-hidden="true" /><strong>没有找到这条小事</strong><p>试试别的关键词，或看看全部备忘。</p><button className="button ghost" type="button" onClick={clearFilters}>清除筛选</button></div>
      ) : (
        <div className="partner-notes-empty"><Heart size={20} /><strong>还没有备忘</strong><p>从一道爱吃的菜、一个小习惯开始，发布第一条吧。</p></div>
      )}
    </section>
  )
}
