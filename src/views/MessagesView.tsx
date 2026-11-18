import { LockKeyhole, Mail, Reply, Send, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { PartnerNotes } from '../components/PartnerNotes'
import {
  formatRevealTime,
  isRevealed,
} from '../lib/time'
import {
  changeMessageDraft, changeReplyDraft, emptyMessageDraft, emptyReplyDraft, messageDraftKey,
  messageDrafts, prepareMessageAttempt, prepareReplyAttempt, revealTimeStatus, runDraftSubmission,
  type MessageDraft, type ReplyDraft, type RevealPreset,
} from '../features/messages/message-drafts'
import type { MessageItem, PartnerNote, PartnerNoteInput } from '../types'

interface MessagesViewProps {
  messages: MessageItem[]
  /** 对方的名字：云端按 memberIds 反向取，本地为 personB。 */
  partnerName: string
  /** 云端当前用户 id；本地模式为空。 */
  myUserId?: string
  cloudMode?: boolean
  onSend: (message: MessageItem) => Promise<void>
  onDelete: (messageId: string) => Promise<void>
  onReply: (messageId: string, text: string, replyId?: string) => Promise<void>
  partnerNotes: PartnerNote[]
  notesScope: string
  onCreateNote: (input: PartnerNoteInput) => Promise<void>
  onUpdateNote: (id: string, input: PartnerNoteInput) => Promise<void>
  onDeleteNote: (id: string) => Promise<void>
  onTogglePinNote: (id: string, pinned: boolean) => Promise<void>
  /** 云端模式下的仅留言刷新（60s 轮询 + 窗口聚焦时补拉）；本地不传。 */
  onRefresh?: () => Promise<unknown>
}

type MessagePanel = 'messages' | 'notes'

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatMessageTimestamp(iso: string) {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return `${time.getFullYear()}年${pad2(time.getMonth() + 1)}月${pad2(time.getDate())}日 ${pad2(time.getHours())}:${pad2(time.getMinutes())}`
}

function localDateTimeInputValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

const revealPresets: Array<{ id: RevealPreset; label: string }> = [
  { id: 'immediate', label: '立刻' },
  { id: 'tonight', label: '今晚 0 点' },
  { id: 'tomorrow', label: '明天早上' },
  { id: 'custom', label: '自定义' },
]

export function MessagesView(props: MessagesViewProps) {
  return <MessagesEditor key={props.notesScope} {...props} />
}

function MessagesEditor({ messages, partnerName, myUserId, cloudMode = false, onSend, onDelete, onReply, partnerNotes, notesScope, onCreateNote, onUpdateNote, onDeleteNote, onTogglePinNote, onRefresh }: MessagesViewProps) {
  const [activePanel, setActivePanel] = useState<MessagePanel>('messages')
  const tabsId = useId()
  const messagesTabRef = useRef<HTMLButtonElement>(null)
  const notesTabRef = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState(() => messageDrafts.readMessage(notesScope) ?? emptyMessageDraft())
  const draftRef = useRef(draft)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, ReplyDraft>>(() => Object.fromEntries(
    messages.flatMap((message) => {
      const reply = messageDrafts.readReply(notesScope, message.id)
      return reply ? [[message.id, reply]] : []
    }),
  ))
  const replyDraftsRef = useRef(replyDrafts)
  const [clock, setClock] = useState(Date.now)
  const [sendError, setSendError] = useState('')
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({})
  const [draftError, setDraftError] = useState('')
  const sending = useRef(false)
  const replying = useRef(false)
  const [busy, setBusy] = useState(false)
  const [openThread, setOpenThread] = useState<string | null>(() => messages.find((message) => replyDrafts[message.id]?.text.trim())?.id ?? null)
  const [replyBusy, setReplyBusy] = useState(false)
  const { text, revealPreset, customTime } = draft
  const replyText = openThread ? replyDrafts[openThread]?.text ?? '' : ''
  const replyError = openThread ? replyErrors[openThread] ?? '' : ''

  function commitMessage(next: MessageDraft) {
    const previous = draftRef.current
    draftRef.current = next
    setDraft(next)
    if (!messageDrafts.writeMessage(notesScope, next, previous)) setDraftError('本机暂时无法保存草稿，请先完成发送，不要刷新页面。')
  }

  function changeMessage(change: Partial<Pick<MessageDraft, 'text' | 'revealPreset' | 'customTime'>>) {
    if (sending.current) return
    commitMessage(changeMessageDraft(draftRef.current, change))
    setSendError('')
  }

  function commitReply(messageId: string, next: ReplyDraft) {
    const previous = replyDraftsRef.current[messageId]
    const updated = { ...replyDraftsRef.current, [messageId]: next }
    replyDraftsRef.current = updated
    setReplyDrafts(updated)
    if (!messageDrafts.writeReply(notesScope, messageId, next, previous)) setDraftError('本机暂时无法保存草稿，请先完成发送，不要刷新页面。')
  }

  function changeReply(messageId: string, value: string) {
    const previous = replyDraftsRef.current[messageId] ?? messageDrafts.readReply(notesScope, messageId) ?? emptyReplyDraft()
    commitReply(messageId, changeReplyDraft(previous, value))
    setReplyErrors((current) => ({ ...current, [messageId]: '' }))
  }

  useEffect(() => {
    const flush = () => {
      messageDrafts.writeMessage(notesScope, draftRef.current)
      Object.entries(replyDraftsRef.current).forEach(([id, reply]) => messageDrafts.writeReply(notesScope, id, reply))
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    const interval = window.setInterval(() => setClock(Date.now()), 10_000)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flush()
      window.clearInterval(interval)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [notesScope])

  useEffect(() => {
    if (!cloudMode || !onRefresh) return
    let debounceTimer = 0
    const debouncedRefresh = () => {
      window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => void onRefresh(), 250)
    }
    const interval = window.setInterval(() => void onRefresh(), 60_000)
    const onVisibility = () => { if (document.visibilityState === 'visible') debouncedRefresh() }
    window.addEventListener('focus', debouncedRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    void onRefresh()
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(debounceTimer)
      window.removeEventListener('focus', debouncedRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cloudMode, onRefresh])

  const revealStatus = revealTimeStatus(revealPreset, customTime, new Date(clock))
  const canSend = text.trim().length > 0 && !revealStatus.error

  function switchPanelFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next: MessagePanel = event.key === 'Home' ? 'messages'
      : event.key === 'End' ? 'notes'
        : activePanel === 'messages' ? 'notes' : 'messages'
    setActivePanel(next)
    const nextTabRef = next === 'messages' ? messagesTabRef : notesTabRef
    nextTabRef.current?.focus()
  }

  async function send() {
    if (sending.current || !draftRef.current.text.trim()) return
    let submitted: ReturnType<typeof prepareMessageAttempt>
    try { submitted = prepareMessageAttempt(draftRef.current, new Date()) }
    catch (reason) { setSendError(reason instanceof Error ? reason.message : '请选择有效的发送时间。'); return }
    sending.current = true
    commitMessage(submitted)
    setBusy(true)
    setSendError('')
    try {
      await runDraftSubmission(messageDraftKey(notesScope), () => onSend(submitted.attempt.message))
      messageDrafts.clearMessage(notesScope, submitted)
      if (draftRef.current.revision === submitted.revision) commitMessage(emptyMessageDraft())
    } catch (reason) {
      setSendError(`${reason instanceof Error ? reason.message : '发送没成功。'} 输入已保留，可以重试。`)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  function toggleThread(messageId: string) {
    if (!replyDraftsRef.current[messageId]) commitReply(messageId, messageDrafts.readReply(notesScope, messageId) ?? emptyReplyDraft())
    setOpenThread((current) => current === messageId ? null : messageId)
  }

  async function sendReply(messageId: string) {
    if (replying.current) return
    const current = replyDraftsRef.current[messageId]
    if (!current?.text.trim()) return
    const submitted = prepareReplyAttempt(current)
    replying.current = true
    commitReply(messageId, submitted)
    setReplyBusy(true)
    setReplyErrors((errors) => ({ ...errors, [messageId]: '' }))
    try {
      await runDraftSubmission(messageDraftKey(notesScope, messageId), () => onReply(messageId, submitted.attempt.text, submitted.attempt.id))
      messageDrafts.clearReply(notesScope, messageId, submitted)
      if (replyDraftsRef.current[messageId]?.revision === submitted.revision) commitReply(messageId, emptyReplyDraft())
    } catch (reason) {
      setReplyErrors((errors) => ({ ...errors, [messageId]: `${reason instanceof Error ? reason.message : '回复没成功。'} 输入已保留，可以重试。` }))
    } finally {
      replying.current = false
      setReplyBusy(false)
    }
  }

  return (
    <div className="page messages-page">
      <header className="page-topbar">
        <div><span className="eyebrow">OUR MESSAGE WALL</span><h1>留言墙</h1><p>想说的话和在意的小事，都留在这里。</p></div>
      </header>

      <div className="message-tabs" role="tablist" aria-label="留言与备忘录">
        <button
          ref={messagesTabRef}
          id={`${tabsId}-messages-tab`}
          type="button"
          role="tab"
          aria-selected={activePanel === 'messages'}
          aria-controls={`${tabsId}-messages-panel`}
          tabIndex={activePanel === 'messages' ? 0 : -1}
          onClick={() => setActivePanel('messages')}
          onKeyDown={switchPanelFromKeyboard}
        >留言<span className="message-tab-count">{messages.length}</span></button>
        <button
          ref={notesTabRef}
          id={`${tabsId}-notes-tab`}
          type="button"
          role="tab"
          aria-selected={activePanel === 'notes'}
          aria-controls={`${tabsId}-notes-panel`}
          tabIndex={activePanel === 'notes' ? 0 : -1}
          onClick={() => setActivePanel('notes')}
          onKeyDown={switchPanelFromKeyboard}
        >备忘录<span className="message-tab-count">{partnerNotes.length}</span></button>
      </div>

      <div className="message-panel" id={`${tabsId}-messages-panel`} role="tabpanel" aria-labelledby={`${tabsId}-messages-tab`} hidden={activePanel !== 'messages'}>
        <section className="message-compose">
          <h2 className="message-compose-heading">写一条留言</h2>
          <textarea
            aria-label="留言内容"
            value={text}
            maxLength={500}
            rows={3}
            placeholder={`写一句想对 ${partnerName} 说的话…`}
            disabled={busy}
            onChange={(event) => changeMessage({ text: event.target.value })}
          />
          <p className="message-reveal-label">选择对方看见的时间</p>
          <div className="message-reveal-row">
            <div className="filter-pills" role="group" aria-label="对方可见时间">
              {revealPresets.map((item) => (
                <button key={item.id} type="button" disabled={busy} aria-pressed={revealPreset === item.id} className={revealPreset === item.id ? 'is-active' : ''} onClick={() => changeMessage({ revealPreset: item.id })}>{item.label}</button>
              ))}
            </div>
            {revealPreset === 'custom' && (
              <input
                className="message-custom-time"
                type="datetime-local"
                aria-label="自定义可见时间"
                value={customTime}
                min={localDateTimeInputValue(new Date())}
                disabled={busy}
                aria-invalid={!!revealStatus.error}
                onChange={(event) => changeMessage({ customTime: event.target.value })}
              />
            )}
          </div>
          <p className={`message-reveal-summary ${revealStatus.error && customTime ? 'form-error' : ''}`} role={revealStatus.error && customTime ? 'alert' : 'status'}>{revealStatus.error || revealStatus.summary}</p>
          {sendError && <p className="form-error" role="alert">{sendError}</p>}
          {draftError && <p className="form-error" role="status">{draftError}</p>}
          <div className="message-send-row">
            <button className="button primary" type="button" disabled={!canSend || busy} onClick={() => void send()}><Send size={16} />{busy ? '发送中…' : sendError || draft.attempt ? '重试发送' : '留在这里'}</button>
          </div>
        </section>

        {messages.length ? (
          <div className="message-list">
            {messages.map((message) => {
              const isOwn = !cloudMode || message.createdBy === myUserId
              const pending = message.revealAt != null && !isRevealed(message.revealAt)
              const replies = message.replies || []
              const threadOpen = openThread === message.id
              return (
                <article className={`message-card ${isOwn ? 'is-own' : ''} ${pending ? 'is-pending' : 'is-revealed'}`} key={message.id}>
                  <div className="message-card-meta">
                    <span className="message-sender">{isOwn ? '我' : partnerName}</span>
                    <time dateTime={message.createdAt}>{formatMessageTimestamp(message.createdAt)}</time>
                    {pending && (
                      <span className="message-lock"><LockKeyhole size={12} />对方 {partnerName} 可见 · {formatRevealTime(message.revealAt as string)}</span>
                    )}
                  </div>
                  <p>{message.text}</p>
                  {isOwn && <button className="message-delete" type="button" aria-label="删除这条留言" onClick={() => void onDelete(message.id)}><Trash2 size={14} /></button>}
                  <div className="message-card-actions">
                    <button className={`message-reply-toggle ${threadOpen ? 'is-active' : ''}`} type="button" aria-expanded={threadOpen} onClick={() => toggleThread(message.id)}>
                      <Reply size={13} />回复{replies.length ? ` ${replies.length}` : ''}
                    </button>
                  </div>
                  {threadOpen && (
                    <div className="message-replies">
                      {replies.map((reply) => {
                        const ownReply = !cloudMode || reply.createdBy === myUserId
                        return (
                          <div className="message-reply-item" key={reply.id}>
                            <div className="message-reply-meta">
                              <span>{ownReply ? '我' : partnerName}</span>
                              <time dateTime={reply.createdAt}>{formatMessageTimestamp(reply.createdAt)}</time>
                            </div>
                            <p>{reply.text}</p>
                          </div>
                        )
                      })}
                      {!replies.length && <p className="message-reply-empty">还没有回复，说点什么吧。</p>}
                      <div className="message-reply-input">
                        <input
                          aria-label="回复内容"
                          value={replyText}
                          maxLength={500}
                          placeholder={isOwn ? '回复自己这条…' : `回复${partnerName}…`}
                          disabled={replyBusy}
                          onChange={(event) => changeReply(message.id, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void sendReply(message.id)
                          }}
                        />
                        <button type="button" aria-label="发送回复" disabled={!replyText.trim() || replyBusy} onClick={() => void sendReply(message.id)}><Send size={13} /></button>
                      </div>
                      {replyError && <p className="form-error" role="alert">{replyError}</p>}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="message-empty">
            <Mail size={22} />
            <strong>还没有留言</strong>
            <p>写下第一句想说的话，选择什么时候让对方看见。</p>
          </div>
        )}
      </div>

      <div className="message-panel" id={`${tabsId}-notes-panel`} role="tabpanel" aria-labelledby={`${tabsId}-notes-tab`} hidden={activePanel !== 'notes'}>
        <PartnerNotes notes={partnerNotes} scope={notesScope} myUserId={myUserId} onCreate={onCreateNote} onUpdate={onUpdateNote} onDelete={onDeleteNote} onTogglePin={onTogglePinNote} />
      </div>
    </div>
  )
}
