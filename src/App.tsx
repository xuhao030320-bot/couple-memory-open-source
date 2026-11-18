import { CloudOff, Heart, RefreshCw } from 'lucide-react'
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppShell } from './components/AppShell'
import { AuthView } from './components/AuthView'
import { CoupleOnboarding } from './components/CoupleOnboarding'
import { SettingsModal } from './components/SettingsModal'
import { Toast } from './components/Toast'
import {
  addCloudMessageReply,
  createCloudAnniversary,
  createCloudCouple,
  createCloudMessage,
  createCloudPartnerNote,
  updateCloudPartnerNote,
  deleteCloudPartnerNote,
  setCloudPartnerNotePinned,
  getCloudSession,
  joinCloudCouple,
  loadCloudMessages,
  loadCloudWorkspace,
  listCloudTrash,
  restoreCloudTrash,
  onCloudAuthChange,
  putCloudMemory,
  removeCloudAnniversary,
  removeCloudMemory,
  removeCloudMessage,
  saveCloudProfile,
  signInWithEmail,
  signOutCloud,
  signUpWithEmail,
  subscribeToCloudWorkspace,
  syncCloudWishes,
  unsubscribeCloudWorkspace,
  updateCloudMemory,
  updateCloudAnniversary,
  type Session,
} from './lib/cloud-storage'
import {
  getAnniversaries,
  getMemories,
  getProfile,
  getWishes,
  putMemory,
  removeMemory,
  saveAnniversaries,
  saveProfile,
  saveWishes,
} from './lib/storage'
import { getInitialMessages, updateLocalMessages } from './lib/local-messages'
import { getLocalPartnerNotes, sortPartnerNotes, updateLocalPartnerNotes, validatePartnerNoteInput } from './lib/partner-notes-data'
import { dataProvider, isCloudConfigured, useCloud, type TrashKind } from './lib/providers'
import { commitWithBackgroundRefresh } from './lib/committed-action'
import { requestBackupTarget, type BackupTarget } from './lib/backup-target'
import { FreshReadGate } from './lib/read-revision'
import type {
  AnniversaryEntry,
  AppView,
  CloudWorkspace,
  CoupleProfile,
  MemoryEntry,
  MessageItem,
  MessageReply,
  PartnerNote,
  PartnerNoteInput,
  WishItem,
} from './types'
const ComposerView = lazy(() => import('./views/ComposerView').then((module) => ({ default: module.ComposerView })))
const HomeView = lazy(() => import('./views/HomeView').then((module) => ({ default: module.HomeView })))
const AnniversariesView = lazy(() => import('./views/AnniversariesView').then((module) => ({ default: module.AnniversariesView })))
const MessagesView = lazy(() => import('./views/MessagesView').then((module) => ({ default: module.MessagesView })))
const TimelineView = lazy(() => import('./views/TimelineView').then((module) => ({ default: module.TimelineView })))
const UsView = lazy(() => import('./views/UsView').then((module) => ({ default: module.UsView })))

async function moveLocalToTrash(...args: Parameters<typeof import('./lib/local-trash').moveLocalToTrash>) {
  return (await import('./lib/local-trash')).moveLocalToTrash(...args)
}

interface ErrorBoundaryState {
  error: Error | null
}

/** 全局崩溃兜底：任何未捕获的渲染/生命周期错误都不再是白屏，而是可恢复的提示页。 */
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="cloud-error-page">
          <CloudOff size={34} />
          <h1>页面遇到了一点问题</h1>
          <p>{this.state.error.message}</p>
          <button
            className="button primary"
            type="button"
            onClick={() => {
              this.setState({ error: null })
              window.scrollTo({ top: 0 })
            }}
          >
            <RefreshCw size={17} />恢复页面
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

function AppInner() {
  const [view, setView] = useState<AppView>('home')
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [profile, setProfile] = useState<CoupleProfile>(() => getProfile())
  const [wishes, setWishes] = useState<WishItem[]>(() => getWishes())
  const [anniversaries, setAnniversaries] = useState<AnniversaryEntry[]>(() => (
    useCloud ? [] : getAnniversaries(profile)
  ))
  const [messages, setMessages] = useState<MessageItem[]>(() => getInitialMessages(useCloud))
  const [partnerNotes, setPartnerNotes] = useState<PartnerNote[]>(() => (
    useCloud ? [] : getLocalPartnerNotes()
  ))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authResolved, setAuthResolved] = useState(!useCloud)
  const [session, setSession] = useState<Session | null>(null)
  const [workspace, setWorkspace] = useState<CloudWorkspace | null>(null)
  const [cloudError, setCloudError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [undoAction, setUndoAction] = useState<{ kind: TrashKind; originalId: string; coupleId: string; userId: string; message: string } | null>(null)
  const [toast, setToast] = useState('')
  const [editingMemory, setEditingMemory] = useState<MemoryEntry | null>(null)
  const [composerReroll, setComposerReroll] = useState(false)
  const [composerDirty, setComposerDirty] = useState(false)
  const activeCloudUserIdRef = useRef<string | null>(null)
  const activeCloudCoupleIdRef = useRef<string | null>(null)
  const cloudRequestEpochRef = useRef(0)
  const partnerNotesRevisionRef = useRef(0)
  const partnerNotesSavingRef = useRef(false)
  const workspaceRef = useRef<CloudWorkspace | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const exportInFlightRef = useRef(false)
  const exportAbortRef = useRef<AbortController | null>(null)
  const undoInFlightRef = useRef(false)
  const messageReadsRef = useRef(new FreshReadGate())

  const updateSession = useCallback((nextSession: Session | null) => {
    if (activeCloudUserIdRef.current !== (nextSession?.user.id || null)) {
      cloudRequestEpochRef.current += 1
      activeCloudCoupleIdRef.current = null
      workspaceRef.current = null
      setWorkspace(null)
      setMemories([])
      setWishes([])
      setAnniversaries([])
      setMessages([])
      setPartnerNotes([])
      setCloudError('')
      setSyncError('')
      setUndoAction(null)
      messageReadsRef.current.changed()
      exportAbortRef.current?.abort()
      setExportProgress('')
      setSyncing(false)
      setEditingMemory(null)
      setComposerDirty(false)
      setView('home')
      setLoading(Boolean(nextSession))
    }
    sessionRef.current = nextSession
    activeCloudUserIdRef.current = nextSession?.user.id || null
    setSession(nextSession)
  }, [])

  const refreshCloudWorkspace = useCallback(async (activeSession = sessionRef.current) => {
    if (!activeSession) return null
    const requestedUserId = activeSession.user.id
    const requestEpoch = ++cloudRequestEpochRef.current
    const notesRevision = partnerNotesRevisionRef.current
    const messageRead = messageReadsRef.current.begin()
    if (activeCloudUserIdRef.current === requestedUserId) {
      setCloudError('')
      setSyncing(true)
    }
    try {
      const nextWorkspace = await loadCloudWorkspace(requestedUserId)
      if (
        requestEpoch !== cloudRequestEpochRef.current
        || activeCloudUserIdRef.current !== requestedUserId
      ) return null
      const coupleChanged = activeCloudCoupleIdRef.current !== (nextWorkspace?.coupleId || null)
      activeCloudCoupleIdRef.current = nextWorkspace?.coupleId || null
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setSyncError('')
      if (nextWorkspace) {
        setProfile(nextWorkspace.profile)
        setMemories(nextWorkspace.memories)
        setWishes(nextWorkspace.wishes)
        setAnniversaries(nextWorkspace.anniversaries)
        if (coupleChanged || messageReadsRef.current.accepts(messageRead)) setMessages(nextWorkspace.messages)
        if (coupleChanged || notesRevision === partnerNotesRevisionRef.current) {
          setPartnerNotes(sortPartnerNotes(nextWorkspace.partnerNotes))
        }
      } else {
        setMemories([])
        setWishes([])
        setAnniversaries([])
        setMessages([])
        setPartnerNotes([])
      }
      return nextWorkspace
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '云端数据读取失败'
      if (
        requestEpoch === cloudRequestEpochRef.current
        && activeCloudUserIdRef.current === requestedUserId
      ) {
        if (workspaceRef.current) setSyncError(message)
        else setCloudError(message)
      }
      throw reason
    } finally {
      if (requestEpoch === cloudRequestEpochRef.current && activeCloudUserIdRef.current === requestedUserId) setSyncing(false)
    }
  }, [])

  /**
   * 仅刷新留言（不刷新整个工作区）。读取共享 epoch 而不递增：
   * 并发的 refreshCloudWorkspace（会递增）仍能作废陈旧的留言拉取，
   * 而留言轮询永远不会取消进行中的工作区刷新。
   */
  const refreshCloudMessages = useCallback(async () => {
    const currentWorkspace = workspaceRef.current
    const currentSession = sessionRef.current
    if (!currentWorkspace || !currentSession) return null
    const requestedUserId = currentSession.user.id
    const requestedCoupleId = currentWorkspace.coupleId
    const requestEpoch = cloudRequestEpochRef.current
    const messageRead = messageReadsRef.current.begin()
    try {
      const nextMessages = await loadCloudMessages(requestedCoupleId)
      if (requestEpoch !== cloudRequestEpochRef.current || activeCloudUserIdRef.current !== requestedUserId
        || activeCloudCoupleIdRef.current !== requestedCoupleId || !messageReadsRef.current.accepts(messageRead)) return null
      setMessages(nextMessages)
      return nextMessages
    } catch (reason) {
      if (activeCloudUserIdRef.current === requestedUserId && activeCloudCoupleIdRef.current === requestedCoupleId) {
        setSyncError(reason instanceof Error ? reason.message : '留言暂未刷新，已有内容和草稿都还在')
      }
      return null
    }
  }, [])

  useEffect(() => {
    if (!useCloud) {
      getMemories()
        .then(setMemories)
        .catch(() => setToast('本地回忆读取失败，请刷新页面重试'))
        .finally(() => setLoading(false))
      return
    }

    if (!isCloudConfigured) {
      setLoading(false)
      setAuthResolved(true)
      return
    }

    let disposed = false
    let authEventVersion = 0
    // CloudBase filters transient credential errors before they reach this callback.
    // The version protects a late startup read from replacing a newer auth event.
    const settleSession = (nextSession: Session | null) => {
      authEventVersion += 1
      if (disposed) return
      updateSession(nextSession)
      setAuthResolved(true)
    }
    const initialAuthEventVersion = authEventVersion
    getCloudSession()
      .then((nextSession) => {
        if (authEventVersion !== initialAuthEventVersion) return
        return settleSession(nextSession)
      })
      .catch((reason: unknown) => {
        if (disposed || authEventVersion !== initialAuthEventVersion) return
        setCloudError(reason instanceof Error ? reason.message : '登录状态读取失败')
        setAuthResolved(true)
      })
    const unsubscribe = onCloudAuthChange((nextSession) => {
      void settleSession(nextSession)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [updateSession])

  useEffect(() => {
    if (!useCloud || !authResolved) return
    if (!session) {
      setWorkspace(null)
      setMemories([])
      setWishes([])
      setAnniversaries([])
      setMessages([])
      setPartnerNotes([])
      setLoading(false)
      return
    }

    setLoading(true)
    refreshCloudWorkspace(session)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [authResolved, refreshCloudWorkspace, session?.user.id])

  const storageScope = useCloud && workspace ? workspace.coupleId : 'local'

  useEffect(() => {
    if (!useCloud) setPartnerNotes(getLocalPartnerNotes(storageScope))
  }, [storageScope])

  useEffect(() => {
    if (!useCloud || !workspace) return
    let refreshTimer = 0
    const channel = subscribeToCloudWorkspace(workspace.coupleId, () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void refreshCloudWorkspace().catch(() => undefined), 250)
    })
    return () => {
      window.clearTimeout(refreshTimer)
      unsubscribeCloudWorkspace(channel)
    }
  }, [refreshCloudWorkspace, workspace?.coupleId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), undoAction?.message === toast ? 10000 : 3200)
    return () => window.clearTimeout(timer)
  }, [toast, undoAction])

  useEffect(() => {
    if (!composerDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [composerDirty])

  function navigate(nextView: AppView) {
    if (
      view === 'compose'
      && composerDirty
      && !window.confirm('这篇回忆还有未保存的修改，确定离开吗？')
    ) {
      return
    }
    setEditingMemory(null)
    setComposerReroll(false)
    setComposerDirty(false)
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleEditMemory(memory: MemoryEntry, reroll = false) {
    setEditingMemory(memory)
    setComposerReroll(reroll)
    setComposerDirty(false)
    setView('compose')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cloudTarget() {
    const currentWorkspace = workspaceRef.current
    const currentSession = sessionRef.current
    if (!currentWorkspace || !currentSession) throw new Error('登录状态已失效，请重新登录')
    const userId = currentSession.user.id
    const coupleId = currentWorkspace.coupleId
    return { userId, coupleId, current: () => activeCloudUserIdRef.current === userId && activeCloudCoupleIdRef.current === coupleId }
  }

  async function refreshLocalWorkspace() {
    setMemories(await getMemories())
    setWishes(getWishes())
    setAnniversaries(getAnniversaries(getProfile()))
    setMessages(getInitialMessages(false))
    setPartnerNotes(getLocalPartnerNotes('local'))
  }

  function announceDeletion(kind: TrashKind, originalId: string, label: string) {
    const message = `${label}已移到回收站`
    setUndoAction({ kind, originalId, coupleId: workspaceRef.current?.coupleId || 'local', userId: sessionRef.current?.user.id || '', message })
    setToast(message)
  }

  async function undoDeletion() {
    if (!undoAction || undoInFlightRef.current) return
    const action = undoAction
    const current = () => !useCloud || (activeCloudUserIdRef.current === action.userId && activeCloudCoupleIdRef.current === action.coupleId)
    if (!current()) return
    undoInFlightRef.current = true
    try {
      const deleted = (await listCloudTrash(action.coupleId)).find((item) => item.kind === action.kind && item.originalId === action.originalId)
      if (!current()) return
      if (!deleted) throw new Error('这条记录已被恢复或已不在回收站')
      await restoreCloudTrash(action.coupleId, deleted.id)
      if (!current()) return
      if (action.kind === 'message') messageReadsRef.current.changed()
      setUndoAction(null)
      setToast('已经撤销删除')
      if (useCloud) void refreshCloudWorkspace().catch(() => undefined)
      else await refreshLocalWorkspace()
    } catch (reason) {
      if (current()) setToast(reason instanceof Error ? reason.message : '恢复没成功，可以在“我们”的回收站重试')
    } finally { undoInFlightRef.current = false }
  }

  async function handleExport() {
    if (exportInFlightRef.current) return
    exportInFlightRef.current = true
    const abort = new AbortController()
    exportAbortRef.current = abort
    let target: ReturnType<typeof cloudTarget> | null = null
    const current = () => !target || target.current()
    let destination: BackupTarget | undefined
    try {
      target = useCloud ? cloudTarget() : null
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      destination = await requestBackupTarget(`只此我们-${date}.zip`)
      setExportProgress('正在整理空间内容…')
      const { createWorkspaceBackup } = await import('./lib/workspace-backup')
      const latest = target ? await loadCloudWorkspace(target.userId) : null
      if (!current() || abort.signal.aborted || (target && latest?.coupleId !== target.coupleId)) throw new DOMException('导出已取消', 'AbortError')
      const snapshot = latest || {
        profile: getProfile(), memories: await getMemories(), wishes: getWishes(),
        anniversaries: getAnniversaries(getProfile()), messages: getInitialMessages(false), partnerNotes: getLocalPartnerNotes('local'),
      }
      const blob = await createWorkspaceBackup({
        provider: dataProvider, scope: target?.coupleId || 'local', profile: snapshot.profile,
        memories: snapshot.memories, wishes: snapshot.wishes, anniversaries: snapshot.anniversaries,
        messages: snapshot.messages, partnerNotes: snapshot.partnerNotes,
      }, {
        writable: destination.writable, signal: abort.signal,
        onProgress: (done, total) => { if (current()) setExportProgress(total ? `正在打包媒体 ${done} / ${total}…` : '正在整理文字与记录…') },
      })
      if (!current() || abort.signal.aborted) throw new DOMException('导出已取消', 'AbortError')
      await destination.finish(blob)
      if (current()) setToast('空间备份已导出，解压后可以直接查看')
    } catch (reason) {
      await destination?.abort(reason)
      if (current() && !(reason instanceof DOMException && reason.name === 'AbortError')) {
        const message = reason instanceof Error ? reason.message : '导出没有完成，请联网后重试'
        setToast(message)
        throw new Error(message)
      }
    } finally {
      exportInFlightRef.current = false
      if (exportAbortRef.current === abort) exportAbortRef.current = null
      if (current()) setExportProgress('')
    }
  }

  async function handleLogin(email: string, password: string) {
    const nextSession = await signInWithEmail(email, password)
    updateSession(nextSession)
  }

  async function handleRegister(displayName: string, email: string, password: string) {
    const data = await signUpWithEmail(displayName, email, password)
    if (data.session) {
      updateSession(data.session)
      return 'signed-in' as const
    }
    return 'verify-email' as const
  }

  async function handleCreateCouple(displayName: string, startDate: string) {
    if (!session) return
    await createCloudCouple(displayName, startDate)
    await refreshCloudWorkspace(session)
    setToast('情侣空间已经创建，可以把邀请码发给对方了')
  }

  async function handleJoinCouple(displayName: string, inviteCode: string) {
    if (!session) return
    await joinCloudCouple(displayName, inviteCode)
    await refreshCloudWorkspace(session)
    setToast('已经加入你们的共同空间')
  }

  async function handleSaveMemory(memory: MemoryEntry) {
    const isUpdate = editingMemory?.id === memory.id
    if (useCloud) {
      const target = cloudTarget()
      await commitWithBackgroundRefresh(
        () => isUpdate ? updateCloudMemory(target.coupleId, memory) : putCloudMemory(target.coupleId, memory),
        async () => {
          if (!target.current()) return
          const refreshed = await refreshCloudWorkspace()
          if (refreshed && target.current()) for (const photo of memory.photos) {
            if (photo.blob && photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src)
          }
        },
      )
      if (!target.current()) return
      setMemories((current) => [memory, ...current.filter((item) => item.id !== memory.id)]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)))
    } else {
      await putMemory(memory)
      setMemories((current) => [memory, ...current.filter((item) => item.id !== memory.id)]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)))
    }
    setEditingMemory(null)
    setComposerReroll(false)
    setComposerDirty(false)
    setToast(isUpdate ? '这篇回忆已经更新并同步了' : '这一刻已经好好保存了')
    setView('memories')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDeleteMemory(id: string) {
    if (useCloud) {
      const target = cloudTarget()
      const memory = memories.find((item) => item.id === id)
      if (!memory) return
      await commitWithBackgroundRefresh(() => removeCloudMemory(target.coupleId, memory), async () => { if (target.current()) await refreshCloudWorkspace() })
      if (!target.current()) return
      setMemories((current) => current.filter((item) => item.id !== id))
    } else {
      const memory = (await getMemories()).find((item) => item.id === id)
      if (!memory) return
      await moveLocalToTrash('local', 'memory', memory)
      await removeMemory(id)
      setMemories((current) => current.filter((memory) => memory.id !== id))
    }
    announceDeletion('memory', id, '这篇回忆')
  }

  async function handleToggleLike(memory: MemoryEntry) {
    const next = { ...memory, isLiked: !memory.isLiked }
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => updateCloudMemory(target.coupleId, next), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
        setMemories((current) => current.map((item) => item.id === next.id ? next : item))
      } else {
        await putMemory(next)
        setMemories((current) => current.map((item) => item.id === next.id ? next : item))
      }
      setToast(next.isLiked ? '已加入喜欢' : '已取消喜欢')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '喜欢状态更新失败')
    }
  }

  async function handleProfileSave(nextProfile: CoupleProfile) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => saveCloudProfile(target.coupleId, target.userId, nextProfile, workspaceRef.current!.memberIds), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
        setProfile(nextProfile)
      } else {
        saveProfile(nextProfile)
        setProfile(nextProfile)
      }
      setSettingsOpen(false)
      setToast('我们的信息已更新')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '资料保存失败')
    }
  }

  async function handleWishesChange(nextWishes: WishItem[]) {
    const previous = wishes
    const removed = previous.filter((wish) => !nextWishes.some((next) => next.id === wish.id))
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => syncCloudWishes(target.coupleId, target.userId, previous, nextWishes), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
      } else {
        for (const wish of removed) await moveLocalToTrash('local', 'wish', wish)
        saveWishes(nextWishes)
      }
      setWishes(nextWishes)
      if (removed[0]) announceDeletion('wish', removed[0].id, '这个愿望')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '愿望同步失败，原内容还在')
    }
  }

  async function handlePartnerNoteMutation(action:
    | { type: 'create'; input: PartnerNoteInput }
    | { type: 'update'; id: string; input: PartnerNoteInput }
    | { type: 'delete'; id: string }
    | { type: 'pin'; id: string; pinned: boolean }
  ): Promise<void> {
    if (partnerNotesSavingRef.current) throw new Error('上一条备忘还在保存，请稍后重试')
    const values = action.type === 'create' || action.type === 'update' ? validatePartnerNoteInput(action.input) : null
    partnerNotesSavingRef.current = true
    try {
      if (useCloud) {
        if (!workspace || !session) throw new Error('登录状态已失效，请重新登录')
        const requestedUserId = session.user.id
        const coupleId = workspace.coupleId
        let saved: PartnerNote | null = null
        if (action.type === 'create') saved = await createCloudPartnerNote(coupleId, values!)
        else if (action.type === 'update') saved = await updateCloudPartnerNote(coupleId, action.id, values!)
        else if (action.type === 'pin') saved = await setCloudPartnerNotePinned(coupleId, action.id, action.pinned)
        else await deleteCloudPartnerNote(coupleId, action.id)
        if (
          activeCloudUserIdRef.current !== requestedUserId
          || activeCloudCoupleIdRef.current !== coupleId
        ) return
        partnerNotesRevisionRef.current += 1
        setPartnerNotes((previous) => sortPartnerNotes(action.type === 'delete'
          ? previous.filter((note) => note.id !== action.id)
          : [...previous.filter((note) => note.id !== saved!.id), saved!]))
        void refreshCloudWorkspace().catch(() => undefined)
      } else {
        if (action.type === 'delete') {
          const removed = getLocalPartnerNotes(storageScope).find((note) => note.id === action.id)
          if (removed) await moveLocalToTrash('local', 'partner_note', removed)
        }
        const next = updateLocalPartnerNotes(storageScope, (previous) => {
          if (action.type === 'create') return [...previous, { ...values!, id: crypto.randomUUID(), createdAt: new Date().toISOString() }]
          if (!previous.some((note) => note.id === action.id)) throw new Error('这条备忘已被删除，请刷新后重试')
          if (action.type === 'delete') return previous.filter((note) => note.id !== action.id)
          if (action.type === 'pin') return previous.map((note) => note.id === action.id ? { ...note, pinned: action.pinned } : note)
          return previous.map((note) => note.id === action.id ? { ...note, ...values! } : note)
        })
        setPartnerNotes(next)
      }
      if (action.type === 'delete') announceDeletion('partner_note', action.id, '这条备忘')
      else setToast(action.type === 'create' ? '备忘已发布' : action.type === 'update' ? '备忘已修改' : action.pinned ? '备忘已置顶' : '已取消置顶')
    } finally {
      partnerNotesSavingRef.current = false
    }
  }

  async function handleCreateAnniversary(entry: AnniversaryEntry) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => createCloudAnniversary(target.coupleId, target.userId, entry), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
        setAnniversaries((current) => [...current.filter((item) => item.id !== entry.id), entry])
      } else {
        const next = [...anniversaries, entry]
        saveAnniversaries(next)
        setAnniversaries(next)
      }
      setToast('这个特别日子已经收藏好了')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '纪念日保存失败'
      setToast(message)
      throw new Error(message)
    }
  }

  async function handleUpdateAnniversary(entry: AnniversaryEntry) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => updateCloudAnniversary(target.coupleId, entry), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
        setAnniversaries((current) => current.map((item) => item.id === entry.id ? entry : item))
      } else {
        const next = anniversaries.map((item) => item.id === entry.id ? entry : item)
        saveAnniversaries(next)
        setAnniversaries(next)
      }
      setToast('纪念日已经更新')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '纪念日更新失败'
      setToast(message)
      throw new Error(message)
    }
  }

  async function handleDeleteAnniversary(entry: AnniversaryEntry) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(() => removeCloudAnniversary(target.coupleId, entry.id), async () => { if (target.current()) await refreshCloudWorkspace() })
        if (!target.current()) return
        setAnniversaries((current) => current.filter((item) => item.id !== entry.id))
      } else {
        await moveLocalToTrash('local', 'anniversary', entry)
        const next = anniversaries.filter((item) => item.id !== entry.id)
        saveAnniversaries(next)
        setAnniversaries(next)
      }
      announceDeletion('anniversary', entry.id, '这个纪念日')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '纪念日删除失败')
    }
  }

  async function handleSendMessage(message: MessageItem) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(async () => {
          await createCloudMessage(target.coupleId, target.userId, message)
          if (target.current()) messageReadsRef.current.changed()
        }, async () => { if (target.current()) await refreshCloudMessages() })
        if (!target.current()) return
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, { ...message, createdBy: target.userId }])
      } else {
        setMessages(updateLocalMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]))
      }
      setToast('留言已经留好了')
    } catch (reason) {
      const errorMessage = reason instanceof Error ? reason.message : '留言保存失败'
      setToast(errorMessage)
      throw new Error(errorMessage)
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(async () => {
          await removeCloudMessage(target.coupleId, messageId)
          if (target.current()) messageReadsRef.current.changed()
        }, async () => { if (target.current()) await refreshCloudMessages() })
        if (!target.current()) return
        setMessages((current) => current.filter((item) => item.id !== messageId))
      } else {
        const message = getInitialMessages(false).find((item) => item.id === messageId)
        if (message) await moveLocalToTrash('local', 'message', message)
        setMessages(updateLocalMessages((current) => current.filter((item) => item.id !== messageId)))
      }
      announceDeletion('message', messageId, '这条留言')
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : '留言删除失败')
    }
  }

  async function handleSendReply(messageId: string, text: string, replyId?: string) {
    const reply: MessageReply = {
      id: replyId || crypto.randomUUID(),
      createdBy: session?.user.id || '',
      text,
      createdAt: new Date().toISOString(),
    }
    try {
      if (useCloud) {
        const target = cloudTarget()
        await commitWithBackgroundRefresh(async () => {
          await addCloudMessageReply(target.coupleId, target.userId, messageId, reply)
          if (target.current()) messageReadsRef.current.changed()
        }, async () => { if (target.current()) await refreshCloudMessages() })
        if (!target.current()) return
        setMessages((current) => current.map((item) => item.id === messageId && !item.replies?.some((existing) => existing.id === reply.id)
          ? { ...item, replies: [...(item.replies || []), reply] } : item))
      } else {
        setMessages(updateLocalMessages((current) => current.map((item) => item.id === messageId && !item.replies?.some((existing) => existing.id === reply.id)
          ? { ...item, replies: [...(item.replies || []), reply] }
          : item)))
      }
    } catch (reason) {
      const errorMessage = reason instanceof Error ? reason.message : '回复发送失败'
      setToast(errorMessage)
      throw new Error(errorMessage)
    }
  }

  if (useCloud && !isCloudConfigured) {
    return <CloudConfigurationMissing />
  }

  if (loading || !authResolved) {
    return <LoadingScreen text={useCloud ? '正在连接你们的共同空间' : '正在翻开我们的故事'} />
  }

  if (useCloud && cloudError) {
    return (
      <main className="cloud-error-page">
        <CloudOff size={34} />
        <h1>云端空间还没有准备好</h1>
        <p>{cloudError}</p>
        <p className="cloud-error-help">{dataProvider === 'cloudbase'
          ? '如果这是第一次连接，请确认已配置云开发环境：数据库集合、安全规则、自定义登录与云函数都已部署。'
          : '如果这是第一次连接，请先在 Supabase SQL Editor 中执行项目的数据库迁移文件。'}</p>
        <button className="button primary" type="button" onClick={() => { setLoading(true); refreshCloudWorkspace().catch(() => undefined).finally(() => setLoading(false)) }}><RefreshCw size={17} />重新连接</button>
      </main>
    )
  }

  if (useCloud && !session) {
    return <AuthView onLogin={handleLogin} onRegister={handleRegister} />
  }

  if (useCloud && session && !workspace) {
    return (
      <CoupleOnboarding
        defaultName={String(session.user.user_metadata.display_name || session.user.email?.split('@')[0] || '')}
        email={session.user.email || ''}
        onCreate={handleCreateCouple}
        onJoin={handleJoinCouple}
        onSignOut={async () => { await signOutCloud(); updateSession(null) }}
      />
    )
  }

  const editablePerson = useCloud && workspace && session
    ? workspace.memberIds[0] === session.user.id ? 'A' : 'B'
    : 'both'

  const partnerName = useCloud && workspace && session
    ? (workspace.memberIds[0] === session.user.id ? workspace.profile.personB : workspace.profile.personA)
    : profile.personB

  const myName = useCloud && workspace && session
    ? (workspace.memberIds[0] === session.user.id ? workspace.profile.personA : workspace.profile.personB)
    : profile.personA

  return (
    <>
      <AppShell activeView={view} profile={profile} cloudMode={useCloud} onNavigate={navigate}>
        {useCloud && workspace && (syncError || syncing) && (
          <aside className={`sync-status ${syncError ? 'has-error' : ''}`} role="status">
            {syncError ? <CloudOff size={16} /> : <RefreshCw size={15} className="spin" />}
            <span>{syncError ? '同步暂未完成，已有内容和草稿都在' : '正在同步更新…'}</span>
            {syncError && <button type="button" disabled={syncing} onClick={() => void refreshCloudWorkspace().catch(() => undefined)}>重试</button>}
          </aside>
        )}
        <Suspense fallback={<div className="view-loading" role="status"><Heart size={22} /><span>正在翻开这一页…</span></div>}>
        {view === 'home' && <HomeView profile={profile} myName={myName} memories={memories} anniversaries={anniversaries} onNavigate={navigate} onSettings={() => setSettingsOpen(true)} />}
        {view === 'memories' && <TimelineView memories={memories} onCompose={() => navigate('compose')} onEdit={handleEditMemory} onDelete={handleDeleteMemory} onToggleLike={handleToggleLike} coupleId={workspace?.coupleId || ''} onToast={setToast} />}
        {view === 'compose' && (
          <ComposerView
            key={`${editingMemory?.id || 'new'}:${composerReroll ? 'reroll' : 'keep'}`}
            draftScope={`${dataProvider}:${storageScope}:${session?.user.id || ''}`}
            onSave={handleSaveMemory}
            initialMemory={editingMemory}
            startWithNewLayout={composerReroll}
            onCancel={editingMemory ? () => navigate('memories') : undefined}
            onDirtyChange={setComposerDirty}
            coupleId={workspace?.coupleId || ''}
            onToast={setToast}
          />
        )}
        {view === 'anniversaries' && (
          <AnniversariesView
            profile={profile}
            anniversaries={anniversaries}
            onCreate={handleCreateAnniversary}
            onUpdate={handleUpdateAnniversary}
            onDelete={handleDeleteAnniversary}
            onSettings={() => setSettingsOpen(true)}
            cloudMode={useCloud}
            coupleId={workspace?.coupleId || ''}
            onToast={setToast}
          />
        )}
        {view === 'messages' && (
          <MessagesView
            messages={messages}
            partnerName={partnerName}
            myUserId={session?.user.id}
            cloudMode={useCloud}
            onSend={handleSendMessage}
            onDelete={handleDeleteMessage}
            onReply={handleSendReply}
            partnerNotes={partnerNotes}
            notesScope={`${dataProvider}:${storageScope}:${session?.user.id || ''}`}
            onCreateNote={(input) => handlePartnerNoteMutation({ type: 'create', input })}
            onUpdateNote={(id, input) => handlePartnerNoteMutation({ type: 'update', id, input })}
            onDeleteNote={(id) => handlePartnerNoteMutation({ type: 'delete', id })}
            onTogglePinNote={(id, pinned) => handlePartnerNoteMutation({ type: 'pin', id, pinned })}
            onRefresh={useCloud ? refreshCloudMessages : undefined}
          />
        )}
        {view === 'us' && (
          <UsView
            profile={profile}
            memories={memories}
            wishes={wishes}
            inviteCode={workspace?.inviteCode}
            cloudMode={useCloud}
            accountEmail={session?.user.email || ''}
            coupleId={workspace?.coupleId || ''}
            onSettings={() => setSettingsOpen(true)}
            onWishesChange={handleWishesChange}
            onNavigate={navigate}
            onSignOut={useCloud ? async () => { await signOutCloud(); updateSession(null) } : undefined}
            onTrashRestored={() => { if (useCloud) void refreshCloudWorkspace().catch(() => undefined); else void refreshLocalWorkspace().catch(() => setToast('记录已恢复，请刷新查看')) }}
            onExport={handleExport}
            exportProgress={exportProgress}
            onToast={setToast}
          />
        )}
        </Suspense>
      </AppShell>
      <SettingsModal open={settingsOpen} profile={profile} editablePerson={editablePerson} onClose={() => setSettingsOpen(false)} onSave={handleProfileSave} />
      <Toast message={toast} onClose={() => setToast('')} action={undoAction?.message === toast ? { label: '撤销', onClick: () => void undoDeletion() } : undefined} />
    </>
  )
}

function LoadingScreen({ text }: { text: string }) {
  return <div className="loading-screen"><span><Heart size={24} fill="currentColor" /></span><strong>{text}</strong></div>
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}

function CloudConfigurationMissing() {
  return (
    <main className="cloud-error-page">
      <CloudOff size={34} />
      <h1>云端后端还没有配置好</h1>
      {dataProvider === 'cloudbase' ? (
        <>
          <p>请设置 <code>VITE_CLOUDBASE_ENV_ID</code> 和 <code>VITE_CLOUDBASE_PUBLISHABLE_KEY</code>。</p>
          <p className="cloud-error-help">在你自己的 CloudBase 环境中获取客户端 Publishable Key，并将本站域名添加到安全域名列表。</p>
        </>
      ) : (
        <>
          <p>请在部署环境中设置 <code>VITE_SUPABASE_URL</code> 和 <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>。</p>
          <p className="cloud-error-help">这两个值可以在 Supabase 项目的 Connect 对话框中找到。不要把 service_role 密钥放进网页。</p>
        </>
      )}
    </main>
  )
}
