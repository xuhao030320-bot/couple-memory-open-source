import type { MessageItem } from '../../types'
import { tonightTimestamp, tomorrowMorningTimestamp } from '../../lib/time'
import type { DraftStorage } from '../memories/compose-drafts'

export type RevealPreset = 'immediate' | 'tonight' | 'tomorrow' | 'custom'
export interface MessageDraft {
  version: 1
  revision: string
  text: string
  revealPreset: RevealPreset
  customTime: string
  attempt?: { fingerprint: string; message: MessageItem }
}
export interface ReplyDraft {
  version: 1
  revision: string
  text: string
  attempt?: { text: string; id: string }
}

export function emptyMessageDraft(): MessageDraft {
  return { version: 1, revision: crypto.randomUUID(), text: '', revealPreset: 'immediate', customTime: '' }
}
export function emptyReplyDraft(): ReplyDraft {
  return { version: 1, revision: crypto.randomUUID(), text: '' }
}
export function changeMessageDraft(current: MessageDraft, change: Partial<Pick<MessageDraft, 'text' | 'revealPreset' | 'customTime'>>): MessageDraft {
  const next = { ...current, ...change }
  return next.text === current.text && next.revealPreset === current.revealPreset && next.customTime === current.customTime
    ? current : { ...next, revision: crypto.randomUUID(), attempt: undefined }
}
export function changeReplyDraft(current: ReplyDraft, text: string): ReplyDraft {
  return text === current.text ? current : { ...current, revision: crypto.randomUUID(), text, attempt: undefined }
}

function fullTime(value: Date) {
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}年${pad(value.getMonth() + 1)}月${pad(value.getDate())}日 ${pad(value.getHours())}:${pad(value.getMinutes())}`
}
export function revealTimeStatus(preset: RevealPreset, customTime: string, now = new Date()) {
  if (preset === 'immediate') return { revealAt: null, error: '', summary: '发布后，对方立即可见。' }
  let revealAt: string
  if (preset === 'custom') {
    if (!customTime) return { revealAt: null, error: '请选择对方可以看见的日期和时间。', summary: '' }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(customTime)
    const time = new Date(customTime)
    const parts = match?.slice(1).map((part) => Number(part || 0))
    if (!parts || !Number.isFinite(time.getTime()) || time.getFullYear() !== parts[0]
      || time.getMonth() + 1 !== parts[1] || time.getDate() !== parts[2]
      || time.getHours() !== parts[3] || time.getMinutes() !== parts[4] || time.getSeconds() !== parts[5]) {
      return { revealAt: null, error: '这个日期或时间无效，请重新选择。', summary: '' }
    }
    if (time.getTime() <= now.getTime()) return { revealAt: null, error: '请选择晚于当前时刻的时间，过去的时间不能用于定时留言。', summary: '' }
    revealAt = time.toISOString()
  } else revealAt = preset === 'tonight' ? tonightTimestamp(now) : tomorrowMorningTimestamp(now)
  return { revealAt, error: '', summary: `${fullTime(new Date(revealAt))}，对方可见。` }
}

function messageFingerprint(draft: MessageDraft) {
  return JSON.stringify([draft.text.trim(), draft.revealPreset, draft.customTime])
}
export function prepareMessageAttempt(draft: MessageDraft, now = new Date()): MessageDraft & { attempt: NonNullable<MessageDraft['attempt']> } {
  if (!draft.text.trim()) throw new Error('先写一句想说的话吧。')
  const status = revealTimeStatus(draft.revealPreset, draft.customTime, now)
  if (status.error) throw new Error(status.error)
  const fingerprint = messageFingerprint(draft)
  if (draft.attempt?.fingerprint === fingerprint && draft.attempt.message.revealAt !== null
    && !(Date.parse(draft.attempt.message.revealAt) > now.getTime())) {
    throw new Error('原定的可见时间已过，请切换时间选项后重新选择。')
  }
  return {
    ...draft,
    attempt: draft.attempt?.fingerprint === fingerprint ? draft.attempt : {
      fingerprint,
      message: { id: crypto.randomUUID(), text: draft.text.trim(), revealAt: status.revealAt, createdAt: now.toISOString() },
    },
  }
}
export function prepareReplyAttempt(draft: ReplyDraft): ReplyDraft & { attempt: NonNullable<ReplyDraft['attempt']> } {
  const text = draft.text.trim()
  if (!text) throw new Error('先写下回复内容吧。')
  return { ...draft, attempt: draft.attempt?.text === text ? draft.attempt : { text, id: crypto.randomUUID() } }
}

export function messageDraftKey(scope: string, threadId?: string) {
  return `only-us-message-draft:v1:${encodeURIComponent(scope)}:${threadId === undefined ? 'message' : `reply-${encodeURIComponent(threadId)}`}`
}
export function createMessageDraftStore(storage?: DraftStorage) {
  const disk = () => storage ?? window.localStorage
  function read(scope: string, threadId?: string): MessageDraft | ReplyDraft | null {
    try {
      const value = JSON.parse(disk().getItem(messageDraftKey(scope, threadId)) || 'null') as MessageDraft | ReplyDraft | null
      if (!value || value.version !== 1 || typeof value.revision !== 'string' || typeof value.text !== 'string') return null
      if (threadId === undefined) {
        const message = value as MessageDraft
        if (!['immediate', 'tonight', 'tomorrow', 'custom'].includes(message.revealPreset) || typeof message.customTime !== 'string') return null
        const attempt = message.attempt
        if (attempt && (typeof attempt.fingerprint !== 'string' || !attempt.message
          || typeof attempt.message.id !== 'string' || typeof attempt.message.text !== 'string'
          || typeof attempt.message.createdAt !== 'string' || (attempt.message.revealAt !== null && typeof attempt.message.revealAt !== 'string'))) return { ...message, attempt: undefined }
      } else if (value.attempt && (typeof (value as ReplyDraft).attempt?.id !== 'string' || typeof (value as ReplyDraft).attempt?.text !== 'string')) return { ...value, attempt: undefined }
      return value
    } catch { return null }
  }
  function write(scope: string, draft: MessageDraft | ReplyDraft, previous?: MessageDraft | ReplyDraft, threadId?: string) {
    try {
      const meaningful = !!draft.text.trim() || (threadId === undefined && ((draft as MessageDraft).revealPreset !== 'immediate' || !!(draft as MessageDraft).customTime))
      if (meaningful) disk().setItem(messageDraftKey(scope, threadId), JSON.stringify(draft))
      else if (previous && read(scope, threadId)?.revision === previous.revision) disk().removeItem(messageDraftKey(scope, threadId))
      return true
    } catch { return false }
  }
  function clearSubmitted(scope: string, submitted: MessageDraft | ReplyDraft, threadId?: string) {
    try {
      const current = read(scope, threadId)
      if (current?.revision !== submitted.revision || JSON.stringify(current.attempt) !== JSON.stringify(submitted.attempt)) return false
      disk().removeItem(messageDraftKey(scope, threadId))
      return true
    } catch { return false }
  }
  return {
    readMessage: (scope: string) => read(scope) as MessageDraft | null,
    readReply: (scope: string, threadId: string) => read(scope, threadId) as ReplyDraft | null,
    writeMessage: (scope: string, draft: MessageDraft, previous?: MessageDraft) => write(scope, draft, previous),
    writeReply: (scope: string, threadId: string, draft: ReplyDraft, previous?: ReplyDraft) => write(scope, draft, previous, threadId),
    clearMessage: (scope: string, draft: MessageDraft) => clearSubmitted(scope, draft),
    clearReply: (scope: string, threadId: string, draft: ReplyDraft) => clearSubmitted(scope, draft, threadId),
  }
}

export const messageDrafts = createMessageDraftStore()
const inFlight = new Set<string>()
export async function runDraftSubmission<T>(key: string, submit: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) throw new Error('上一条还在发送，请稍后重试。')
  inFlight.add(key)
  try { return await submit() } finally { inFlight.delete(key) }
}
