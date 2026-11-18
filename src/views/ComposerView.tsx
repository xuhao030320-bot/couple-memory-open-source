import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarHeart,
  Check,
  Coffee,
  ImagePlus,
  LoaderCircle,
  LocateFixed,
  Map,
  MapPin,
  Plane,
  Save,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LayoutPreview } from '../components/LayoutPreview'
import { MapPickerModal } from '../components/MapPickerModal'
import { MediaAssetView } from '../components/MediaAssetView'
import { MemoryMap } from '../components/MemoryMap'
import { reverseGeocode } from '../lib/amap'
import { aiEdit, type AiEditUpdates } from '../lib/ai'
import { createLayoutProvider } from '../features/layout'
import {
  createComposerInitialState,
  draftFingerprint,
} from '../features/memories/compose-state'
import { composerDrafts, makeComposerDraft, type ComposerDraftRecord } from '../features/memories/compose-drafts'
import { runDraftSubmission } from '../features/messages/message-drafts'
import {
  MEMORY_CATEGORIES,
  nextLayoutTemplate,
  tagsWithCategory,
} from '../features/memories/memory'
import { filesToPhotoAssets } from '../lib/image'
import type {
  LayoutStyle,
  LayoutTemplate,
  MemoryCategory,
  MemoryEntry,
  PhotoAsset,
} from '../types'

interface ComposerViewProps {
  draftScope: string
  onSave: (memory: MemoryEntry) => Promise<void>
  initialMemory?: MemoryEntry | null
  startWithNewLayout?: boolean
  onCancel?: () => void
  onDirtyChange?: (dirty: boolean) => void
  /** 云端情侣空间 ID；为空时隐藏 AI 排版入口。 */
  coupleId?: string
  onToast?: (message: string) => void
}

interface DraftLayout {
  title: string
  text: string
  style: LayoutStyle
  template: LayoutTemplate
  photos: PhotoAsset[]
  tags: string[]
}

const styleOptions: Array<{ id: LayoutStyle; name: string; english: string; color: string }> = [
  { id: 'cream', name: '奶油手账', english: 'CREAM NOTE', color: '#d9775f' },
  { id: 'film', name: '暮色胶片', english: 'DUSK FILM', color: '#3f5d5a' },
  { id: 'minimal', name: '清透留白', english: 'QUIET', color: '#8d9b8a' },
  { id: 'ticket', name: '旅途票根', english: 'TICKET', color: '#d49a54' },
]

const categoryIcons = {
  daily: Coffee,
  travel: Plane,
  anniversary: CalendarHeart,
} satisfies Record<MemoryCategory, typeof Coffee>

const moodOptions = ['🥰', '😊', '🥳', '😌', '🤭', '🥺', '🌈', '💗']

const THEME_COLORS = ['#d96f56', '#e0883a', '#d4a24e', '#8fa98c', '#6f93a8', '#8d7ab5', '#c26a8a', '#8b8077']
const provider = createLayoutProvider()

export function ComposerView(props: ComposerViewProps) {
  return <ComposerEditor key={`${props.draftScope}:${props.initialMemory?.id ?? 'new'}:${Boolean(props.startWithNewLayout)}`} {...props} />
}

function ComposerEditor({
  draftScope,
  onSave,
  initialMemory = null,
  startWithNewLayout = false,
  onCancel,
  onDirtyChange,
  coupleId,
  onToast,
}: ComposerViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editing = Boolean(initialMemory)
  const target = initialMemory?.id ?? null
  const [initialState] = useState(() => {
    const base = createComposerInitialState(initialMemory, null, startWithNewLayout)
    const record = composerDrafts.read(draftScope, target, base.baseline)
    const restored = record ? { ...record.fields, photos: record.mediaKey ? [] : record.fields.photos } : base.fields
    if (record && startWithNewLayout) restored.template = nextLayoutTemplate(restored.template, record.fields.photos.length)
    return { ...base, fields: restored, record, restoredFromDraft: Boolean(record) }
  })
  const initialFields = initialState.fields
  const [restoredFromDraft, setRestoredFromDraft] = useState(initialState.restoredFromDraft)
  const [title, setTitle] = useState(initialFields.title)
  const [text, setText] = useState(initialFields.text)
  const [date, setDate] = useState(initialFields.date)
  const [location, setLocation] = useState(initialFields.location)
  const [latitude, setLatitude] = useState<number | undefined>(initialFields.latitude)
  const [longitude, setLongitude] = useState<number | undefined>(initialFields.longitude)
  const [category, setCategory] = useState<MemoryCategory>(initialFields.category)
  const [moodEmoji, setMoodEmoji] = useState(initialFields.moodEmoji)
  const [moodText, setMoodText] = useState(initialFields.moodText)
  const [customMoodOpen, setCustomMoodOpen] = useState(false)
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const [themeColor, setThemeColor] = useState(initialFields.themeColor)
  const [style, setStyle] = useState<LayoutStyle>(initialFields.style)
  const [template, setTemplate] = useState<LayoutTemplate>(initialFields.template)
  const [photos, setPhotos] = useState<PhotoAsset[]>(initialFields.photos)
  const [tags, setTags] = useState<string[]>(initialFields.tags)
  const [hasLayout, setHasLayout] = useState(Boolean(initialMemory) || initialState.record?.layoutReady === true)
  const [busy, setBusy] = useState<'images' | 'layout' | 'location' | 'ai' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiRounds, setAiRounds] = useState<Array<{ instruction: string; reply: string }>>([])
  const [hydration, setHydration] = useState<'loading' | 'ready' | 'error'>(initialState.record?.mediaKey ? 'loading' : 'ready')
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [draftError, setDraftError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(startWithNewLayout)
  const alive = useRef(true)
  const mediaRestored = useRef(!initialState.record?.mediaKey)
  const persistenceFailed = useRef(false)
  const saved = useRef(false)
  const saveInFlight = useRef(false)
  const latestRecord = useRef<ComposerDraftRecord | null>(initialState.record)
  const identity = useRef({ memoryId: initialState.record?.memoryId ?? initialMemory?.id ?? crypto.randomUUID(), createdAt: initialState.record?.createdAt ?? initialMemory?.createdAt ?? '' })

  const previewTags = useMemo(() => tagsWithCategory(tags, category), [category, tags])
  const initialFingerprint = useRef(initialState.record?.baselineFingerprint ?? draftFingerprint(initialState.baseline))
  const currentFields = useMemo(() => ({
    title,
    text,
    date,
    location,
    latitude,
    longitude,
    category,
    moodEmoji,
    moodText,
    themeColor,
    style,
    template,
    photos,
    tags,
  }), [category, date, latitude, location, longitude, moodEmoji, moodText, photos, style, tags, template, text, themeColor, title])
  const currentFingerprint = useMemo(() => draftFingerprint(currentFields), [currentFields])

  function persist(record: ComposerDraftRecord) {
    if (alive.current) setDraftStatus('saving')
    const operation = composerDrafts.persist(record)
    void operation.then(() => {
      if (alive.current && latestRecord.current?.snapshotId === record.snapshotId) {
        persistenceFailed.current = false
        setDraftStatus('saved')
        setDraftError('')
      }
    }).catch((reason) => {
      if (alive.current && latestRecord.current?.snapshotId === record.snapshotId) {
        persistenceFailed.current = true
        setDraftStatus('error')
        setDraftError(`本机草稿暂时没保存成功，请保留当前页面后重试。${reason instanceof Error ? reason.message : ''}`)
      }
    })
    return operation
  }

  async function restoreMedia() {
    if (!initialState.record) return
    setHydration('loading')
    try {
      const restored = await composerDrafts.restore(initialState.record)
      if (!alive.current) return
      latestRecord.current = { ...initialState.record, fields: restored }
      mediaRestored.current = true
      setPhotos(restored.photos)
      setHydration('ready')
      setDraftError('')
    } catch (reason) {
      if (!alive.current) return
      setHydration('error')
      setDraftError(reason instanceof Error ? reason.message : '媒体草稿暂时无法恢复，请重试。')
    }
  }

  function continueWithoutDraftMedia() {
    if (!window.confirm('无法恢复的照片或视频会从这份草稿中移除，文字会保留。确定继续吗？')) return
    mediaRestored.current = true
    setPhotos(initialState.baseline.photos)
    setHydration('ready')
    setDraftError('')
    if (draftFingerprint({ ...currentFields, photos: initialState.baseline.photos }) === initialFingerprint.current) setRestoredFromDraft(false)
  }

  useLayoutEffect(() => {
    alive.current = true
    const flush = () => {
      if (!saved.current && mediaRestored.current && latestRecord.current) void composerDrafts.persist(latestRecord.current).catch(() => undefined)
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush()
      if (composerDrafts.hasPendingMedia() || persistenceFailed.current) { event.preventDefault(); event.returnValue = '' }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive.current = false
      flush()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [draftScope, target])

  useEffect(() => {
    void composerDrafts.prepare().catch(() => undefined)
    if (initialState.record?.mediaKey) void restoreMedia()
  }, [])

  // Synchronous metadata writes replace the old debounce; the media transaction starts at once.
  useLayoutEffect(() => {
    if (hydration !== 'ready') return
    if (saved.current && currentFingerprint === initialFingerprint.current) return
    saved.current = false
    if (currentFingerprint === initialFingerprint.current) {
      const previous = latestRecord.current
      latestRecord.current = null
      if (previous) void composerDrafts.clearSnapshot(previous).catch(() => undefined)
      return
    }
    const record = makeComposerDraft(draftScope, target, currentFields, initialFingerprint.current, { ...identity.current, layoutReady: hasLayout }, latestRecord.current)
    latestRecord.current = record
    void persist(record)
  }, [currentFingerprint, hydration, hasLayout, draftScope, target])

  useEffect(() => {
    onDirtyChange?.(hydration !== 'ready' || currentFingerprint !== initialFingerprint.current)
  }, [currentFingerprint, hydration, onDirtyChange])

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return
    setError('')
    setBusy('images')
    try {
      const room = 9 - photos.length
      if (room <= 0) throw new Error('一篇记录最多放 9 份照片或视频')
      const added = await filesToPhotoAssets(Array.from(fileList).slice(0, room))
      setPhotos((current) => [...current, ...added].map((photo, index) => ({
        ...photo,
        order: index,
        role: index === 0 ? 'cover' : 'supporting',
      })))
      setHasLayout(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '媒体处理失败，请换一个文件试试')
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function movePhoto(index: number, offset: -1 | 1) {
    const target = index + offset
    if (target < 0 || target >= photos.length) return
    setPhotos((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((photo, photoIndex) => ({
        ...photo,
        order: photoIndex,
        role: photoIndex === 0 ? 'cover' : 'supporting',
      }))
    })
  }

  async function generateLayout(reroll = true): Promise<DraftLayout | null> {
    setError('')
    if (!text.trim() && photos.length === 0) {
      setError('先写几句话，或者放一份照片或视频吧')
      return null
    }

    setBusy('layout')
    try {
      const generated = await provider.generate({
        title,
        originalText: text,
        date,
        location,
        style,
        photos,
        category,
      })
      if (!alive.current) return null
      const nextTemplate = reroll
        ? nextLayoutTemplate(template, photos.length)
        : generated.template
      const nextTags = tagsWithCategory(generated.tags, category)
      const draft = {
        title: generated.title,
        text: generated.polishedText,
        style: generated.palette,
        template: nextTemplate,
        photos: generated.photos,
        tags: nextTags,
      }
      setTitle(draft.title)
      setText(draft.text)
      setStyle(draft.style)
      setTemplate(draft.template)
      setPhotos(draft.photos)
      setTags(draft.tags)
      setHasLayout(true)
      if (reroll) setPreviewOpen(true)
      return draft
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排版失败，请稍后再试')
      return null
    } finally {
      setBusy(null)
    }
  }

  /** 应用 AI 返回的改动增量（未提及字段不动）。 */
  function applyAiUpdates(updates: AiEditUpdates) {
    if (updates.title !== undefined) setTitle(updates.title)
    if (updates.text !== undefined) { setText(updates.text); setHasLayout(true) }
    if (updates.style !== undefined) setStyle(updates.style)
    if (updates.template !== undefined) setTemplate(updates.template)
    if (updates.tags !== undefined) setTags(updates.tags.filter((tag) => !['日常', '旅行', '纪念日'].includes(tag)))
    if (updates.category !== undefined && MEMORY_CATEGORIES.some((item) => item.id === updates.category)) {
      setCategory(updates.category as MemoryCategory)
    }
    if (updates.location !== undefined) setLocation(updates.location)
    if (updates.moodEmoji !== undefined) setMoodEmoji(updates.moodEmoji)
    if (updates.moodText !== undefined) setMoodText(updates.moodText)
  }

  /** 排版对话：把指令 + 当前草稿发给 AI，返回的增量直接应用到表单。 */
  async function sendAiInstruction() {
    const instruction = aiInstruction.trim()
    if (!instruction || busy !== null || !coupleId) return
    setError('')
    setBusy('ai')
    try {
      const { reply, updates } = await aiEdit(coupleId, instruction, {
        title, text, location, category, moodEmoji, moodText, style, template,
        tags: tagsWithCategory(tags, category), photoCount: photos.length,
      })
      applyAiUpdates(updates)
      setAiRounds((current) => [...current, { instruction, reply }].slice(-6))
      setAiInstruction('')
      onToast?.(reply)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'AI 助手暂时走神了，请再试一次'
      setError(message)
      onToast?.(message)
    } finally {
      setBusy(null)
    }
  }

  async function locateCurrentPosition() {
    setError('')
    if (!window.isSecureContext) {
      setError('定位需要 HTTPS；请使用 Vercel 地址或 localhost 打开')
      return
    }
    if (!navigator.geolocation) {
      setError('当前浏览器不支持定位，可以继续手动填写地点')
      return
    }

    setBusy('location')
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10_000,
          maximumAge: 300_000,
        })
      })
      setLatitude(position.coords.latitude)
      setLongitude(position.coords.longitude)
      setLocation((current) => current.trim() || '当前位置')
    } catch (reason) {
      const geoError = reason as GeolocationPositionError
      if (geoError.code === geoError.PERMISSION_DENIED) setError('定位权限被拒绝，请在浏览器设置中允许位置权限后重试')
      else if (geoError.code === geoError.TIMEOUT) setError('定位超时，请到窗边或打开手机定位后重试')
      else setError('暂时无法取得位置，可以继续手动填写地点')
    } finally {
      setBusy(null)
    }
  }

  async function handleMapConfirm(latitude: number, longitude: number) {
    setMapPickerOpen(false)
    setLatitude(latitude)
    setLongitude(longitude)
    const name = await reverseGeocode(latitude, longitude)
    setLocation((current) => name || current.trim() || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
  }

  async function saveMemory() {
    if (saveInFlight.current || busy !== null || hydration !== 'ready') return
    saveInFlight.current = true
    setError('')
    let draft: DraftLayout = { title, text, style, template, photos, tags: previewTags }
    if (!hasLayout) {
      const generated = await generateLayout(false)
      if (!generated) { saveInFlight.current = false; return }
      draft = generated
    }

    setBusy('save')
    if (!identity.current.createdAt) identity.current.createdAt = new Date().toISOString()
    const submittedFields = { ...currentFields, title: draft.title, text: draft.text, style: draft.style, template: draft.template, photos: draft.photos, tags: draft.tags }
    const submittedRecord = makeComposerDraft(draftScope, target, submittedFields, initialFingerprint.current, { ...identity.current, layoutReady: true }, latestRecord.current)
    latestRecord.current = submittedRecord
    // Draft durability failure does not prevent publishing the in-memory media.
    await persist(submittedRecord).catch(() => undefined)
    try {
      if (!alive.current) return
      await runDraftSubmission(`memory:${draftScope}:${target ?? 'new'}`, () => onSave({
        id: identity.current.memoryId,
        title: draft.title,
        originalText: draft.text.trim(),
        displayText: draft.text,
        date,
        location: location.trim(),
        latitude,
        longitude,
        style: draft.style,
        template: draft.template,
        photos: draft.photos,
        tags: tagsWithCategory(draft.tags, category),
        category,
        moodEmoji,
        moodText: moodText.trim(),
        themeColor: themeColor || undefined,
        createdAt: identity.current.createdAt,
        isDemo: false,
        isLiked: initialMemory?.isLiked === true,
      }))
      saved.current = true
      initialFingerprint.current = draftFingerprint(submittedFields)
      await composerDrafts.clearSnapshot(submittedRecord).catch(() => undefined)
      latestRecord.current = null
      if (alive.current) {
        setRestoredFromDraft(false)
        setDraftStatus('saved')
        onDirtyChange?.(false)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请稍后再试')
    } finally {
      saveInFlight.current = false
      setBusy(null)
    }
  }

  return (
    <div className="page composer-page">
      {restoredFromDraft && (
        <p className="draft-restored-note">已恢复上次未完成的草稿，继续写就好（保存成功后会自动清除）。</p>
      )}
      <header className="page-topbar composer-topbar">
        <div>
          <span className="eyebrow">{editing ? 'EDIT MEMORY' : 'NEW MEMORY'}</span>
          <h1>{editing ? '修改这篇回忆' : '记录这一刻'}</h1>
          <p>{editing ? '文字、心情、地点和排版都可以继续调整。' : '不用写得完整，真实就已经很好。'}</p>
        </div>
        <span className="provider-chip"><Sparkles size={14} />{provider.label}</span>
      </header>

      {editing && (
        <div className="editing-memory-banner">
          <span>{startWithNewLayout ? '已经换了一种版式，满意后记得保存。' : '正在编辑已发布的回忆，保存后会同步给对方。'}</span>
          {onCancel && <button type="button" onClick={onCancel}><ArrowLeft size={15} />返回回忆</button>}
        </div>
      )}

      {hydration === 'loading' && <p className="draft-restored-note" role="status">正在恢复草稿中的照片和视频…</p>}
      {draftStatus === 'saving' && hydration === 'ready' && <p className="composer-draft-status" role="status">正在保存本机草稿，请稍候…</p>}
      {draftError && <div className="form-error" role="alert"><p>{draftError}</p><button type="button" onClick={() => hydration === 'error' ? void restoreMedia() : latestRecord.current && void persist(latestRecord.current)}>重试保存或恢复</button>{hydration === 'error' && <button type="button" onClick={continueWithoutDraftMedia}>保留文字，重新选择媒体</button>}</div>}

      <div className="composer-grid">
        <section className="editor-card">
          <fieldset className="composer-fields" disabled={hydration !== 'ready' || busy !== null} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="editor-section">
            <div className="editor-heading"><span>01</span><div><h2>放入照片或视频</h2><p>最多 9 份，第一份会作为封面</p></div></div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v,.mov,.mp4,.m4v"
              multiple
              hidden
              onChange={(event) => addFiles(event.target.files)}
            />
            {photos.length === 0 ? (
              <button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy === 'images'}>
                {busy === 'images' ? <LoaderCircle className="spin" size={30} /> : <ImagePlus size={30} />}
                <strong>{busy === 'images' ? '正在整理媒体…' : '选择照片或视频'}</strong>
                <span>支持图片、MP4、MOV、M4V 和 WebM</span>
              </button>
            ) : (
              <div className="photo-editor-list">
                {photos.map((photo, index) => (
                  <div className={`photo-editor-item ${photo.kind === 'video' ? 'is-video' : ''}`} key={photo.id}>
                    <MediaAssetView asset={photo} controls={false} muted />
                    <span>{index === 0 ? '封面' : String(index + 1).padStart(2, '0')}</span>
                    {photo.kind === 'video' && <i className="media-kind-badge"><Video size={12} />视频</i>}
                    <div>
                      <button type="button" aria-label="前移" disabled={index === 0} onClick={() => movePhoto(index, -1)}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="后移" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)}><ArrowDown size={14} /></button>
                      <button type="button" aria-label="删除媒体" onClick={() => {
                        setPhotos((current) => current
                          .filter((item) => item.id !== photo.id)
                          .map((item, itemIndex) => ({ ...item, order: itemIndex, role: itemIndex === 0 ? 'cover' : 'supporting' })))
                        setHasLayout(false)
                      }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
                {photos.length < 9 && <button className="add-photo-tile" type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={22} /><span>继续添加</span></button>}
              </div>
            )}
            <details className="live-photo-note">
              <summary>实况照片与视频说明</summary>
              <p>iPhone 实况照片若能选出 MOV 会按视频保存；只选到 HEIC/JPEG 时会保存静态画面。单个视频请小于 45 MB。</p>
            </details>
          </div>

          <div className="editor-section">
            <div className="editor-heading"><span>02</span><div><h2>写下当时</h2><p>排版生成后，这里的文字仍然可以继续编辑</p></div></div>
            <label className="field-row"><span>想说的话</span><textarea value={text} maxLength={1200} placeholder="今天发生了什么？当时是什么心情……" onChange={(event) => setText(event.target.value)} /><small>{text.length} / 1200</small></label>
            <label className="field-row"><span>标题（可选）</span><input value={title} maxLength={32} placeholder="给这一天起个名字" onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field-row"><span>日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          </div>

          <details className="composer-advanced">
            <summary>完善这篇回忆<span>地点、分类、心情与氛围（可选）</span></summary>
            <div className="editor-section">
              <div className="editor-heading"><MapPin size={18} /><div><h2>地点</h2><p>也可以稍后再补充</p></div></div>
              <label className="field-row input-with-icon"><span>地点（可选）</span><div><MapPin size={16} /><input value={location} maxLength={40} placeholder="在哪里" onChange={(event) => {
                setLocation(event.target.value)
                setLatitude(undefined)
                setLongitude(undefined)
              }} /></div></label>
            <div className="location-actions">
              <button type="button" disabled={busy !== null} onClick={locateCurrentPosition}>
                {busy === 'location' ? <LoaderCircle className="spin" size={16} /> : <LocateFixed size={16} />}
                {latitude !== undefined ? '重新定位' : '定位当前位置'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => setMapPickerOpen(true)}><Map size={16} />在地图上选点</button>
              {latitude !== undefined && longitude !== undefined && (
                <button type="button" onClick={() => { setLatitude(undefined); setLongitude(undefined) }}>清除定位</button>
              )}
            </div>
            <MemoryMap latitude={latitude} longitude={longitude} location={location} compact />
          </div>

          <div className="editor-section">
            <div className="editor-heading"><span>03</span><div><h2>分类与心情</h2><p>选个分类，记下今天的心情</p></div></div>
            <div className="memory-category-picker" role="group" aria-label="回忆分类">
              {MEMORY_CATEGORIES.map((option) => {
                const Icon = categoryIcons[option.id]
                return (
                  <button key={option.id} type="button" aria-pressed={category === option.id} className={category === option.id ? 'is-active' : ''} onClick={() => setCategory(option.id)}>
                    <Icon size={19} />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                    {category === option.id && <Check size={16} />}
                  </button>
                )
              })}
            </div>
            <div className="mood-editor">
              <span>今天的心情</span>
              <div className="mood-emoji-picker" role="group" aria-label="选择心情表情">
                {moodOptions.map((emoji) => <button key={emoji} type="button" aria-label={`心情 ${emoji}`} aria-pressed={!customMoodOpen && moodEmoji === emoji} className={!customMoodOpen && moodEmoji === emoji ? 'is-active' : ''} onClick={() => { setMoodEmoji(emoji); setCustomMoodOpen(false) }}>{emoji}</button>)}
                <button type="button" aria-label="自定义心情表情" aria-pressed={customMoodOpen} className={customMoodOpen ? 'is-active' : ''} onClick={() => setCustomMoodOpen((open) => !open)}>✏️</button>
              </div>
              {customMoodOpen && (
                <input aria-label="自定义心情表情" value={moodOptions.includes(moodEmoji) ? '' : moodEmoji} maxLength={4} placeholder="输入一个 emoji，如 🦄" onChange={(event) => setMoodEmoji(event.target.value)} />
              )}
              <input aria-label="文字心情状态" value={moodText} maxLength={32} placeholder="像微信状态一样，写一句现在的状态" onChange={(event) => setMoodText(event.target.value)} />
              <small>{moodText.length} / 32</small>
            </div>
          </div>

          <div className="editor-section">
            <div className="editor-heading"><span>04</span><div><h2>选择一种氛围</h2><p>挑一种喜欢的氛围，随时换排版</p></div></div>
            <div className="style-picker" role="group" aria-label="回忆氛围">
              {styleOptions.map((option) => (
                <button key={option.id} type="button" aria-pressed={style === option.id} className={style === option.id ? 'is-active' : ''} onClick={() => setStyle(option.id)}>
                  <i style={{ backgroundColor: option.color }} />
                  <span><strong>{option.name}</strong><small>{option.english}</small></span>
                  {style === option.id && <Check size={16} />}
                </button>
              ))}
            </div>
            <div className="theme-color-row">
              <span>氛围色</span>
              <div className="theme-color-swatches" role="group" aria-label="氛围色">
                {THEME_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`氛围色 ${color}`}
                    aria-pressed={themeColor === color}
                    className={`theme-swatch ${themeColor === color ? 'is-active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setThemeColor(color)}
                  />
                ))}
                <label className={`theme-swatch is-custom ${themeColor && !THEME_COLORS.includes(themeColor) ? 'is-active' : ''}`} title="自定义颜色">
                  <input
                    type="color"
                    aria-label="自定义氛围色"
                    value={themeColor && !THEME_COLORS.includes(themeColor) ? themeColor : '#d96f56'}
                    onChange={(event) => setThemeColor(event.target.value)}
                  />
                  <span aria-hidden="true">🎨</span>
                </label>
                {themeColor && (
                  <button type="button" className="theme-clear" onClick={() => setThemeColor('')}>清除</button>
                )}
              </div>
            </div>
          </div>

          {coupleId && (
            <div className="ai-composer-panel">
              <div className="ai-composer-heading"><Sparkles size={15} /><span>对 AI 说</span><small>例如：标题再可爱一点 / 换成胶片版式 / 加个旅行标签</small></div>
              {aiRounds.length > 0 && (
                <div className="ai-composer-rounds">
                  {aiRounds.map((round, index) => (
                    <div className="ai-composer-round" key={index}>
                      <span className="ai-composer-question">{round.instruction}</span>
                      <span className="ai-composer-answer">{round.reply}</span>
                    </div>
                  ))}
                </div>
              )}
              <form className="ai-composer-input" onSubmit={(event) => { event.preventDefault(); void sendAiInstruction() }}>
                <input value={aiInstruction} placeholder="告诉 AI 怎么改这篇回忆…" onChange={(event) => setAiInstruction(event.target.value)} />
                <button type="submit" disabled={busy !== null || !aiInstruction.trim()}>
                  {busy === 'ai' ? <LoaderCircle className="spin" size={16} /> : '发送'}
                </button>
              </form>
            </div>
          )}
          </details>
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="editor-actions composer-save-bar">
            {editing && onCancel && <button className="button ghost" type="button" disabled={busy !== null} onClick={onCancel}>取消</button>}
            <button className="button secondary" type="button" disabled={busy !== null || hydration !== 'ready'} onClick={() => void generateLayout(true)}>
              {busy === 'layout' ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}换个排版
            </button>
            <button className="button primary" type="button" disabled={busy !== null || hydration !== 'ready'} onClick={saveMemory}>
              {busy === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{editing ? '保存修改' : '保存这篇回忆'}
            </button>
          </div>
        </section>

        <details className="composer-preview" open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
          <summary>查看排版预览<span>需要时再展开，保存后仍可调整</span></summary>
          <aside className="preview-panel">
          <div className="preview-panel-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h2>实时预览</h2></div><span><ImagePlus size={14} />{photos.length} 份媒体</span></div>
          <LayoutPreview
            title={title}
            text={text}
            date={date}
            location={location}
            style={style}
            template={template}
            photos={photos}
            tags={previewTags}
            moodEmoji={moodEmoji}
            moodText={moodText}
            themeColor={themeColor || undefined}
            compact
          />
          <p className="preview-help">这里会即时显示最终效果。保存前可以反复换版式，也可以继续修改生成后的文字。</p>
          </aside>
        </details>
      </div>

      {mapPickerOpen && (
        <MapPickerModal
          initial={latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined}
          onConfirm={(nextLatitude, nextLongitude) => void handleMapConfirm(nextLatitude, nextLongitude)}
          onClose={() => setMapPickerOpen(false)}
        />
      )}
    </div>
  )
}
