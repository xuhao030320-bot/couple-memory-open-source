import type { LayoutStyle, LayoutTemplate } from '../types'
import { dataProvider } from './providers'

/** AI 模型与推理强度（存本机 localStorage，每次调用随请求下发）。 */
export type AiModel = 'flash' | 'pro'
export type AiStrength = 'low' | 'high' | 'xhigh'
export interface AiSettings {
  model: AiModel
  strength: AiStrength
}

const AI_SETTINGS_KEY = 'only-us-ai-settings'
const DEFAULT_SETTINGS: AiSettings = { model: 'flash', strength: 'low' }

export function readAiSettings(): AiSettings {
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<AiSettings> : {}
    return {
      model: parsed.model === 'pro' ? 'pro' : 'flash',
      strength: parsed.strength === 'high' || parsed.strength === 'xhigh' ? parsed.strength : 'low',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeAiSettings(settings: AiSettings) {
  try {
    window.localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 忽略
  }
}

function aiTuning() {
  const settings = readAiSettings()
  return { model: settings.model, strength: settings.strength }
}

/**
 * AI 能力统一入口，使用当前数据服务的 aiAccess 函数和登录会话。
 * 所有动作共用一份响应形状：失败时 { ok:false, message }。
 */

export interface AiComposeInput {
  text: string
  location?: string
  moodEmoji?: string
  category?: string
  photoCount?: number
  hasPortrait?: boolean
}

export interface AiComposeResult {
  title: string
  text: string
  style: LayoutStyle
  template: LayoutTemplate
  tags: string[]
  photoNote: string
}

interface AiAccessResponse {
  ok: boolean
  code?: string
  message?: string
  title?: string
  text?: string
  style?: string
  template?: string
  tags?: string[]
  photoNote?: string
  answer?: string
  question?: string
  blessing?: string
  reply?: string
  matches?: Array<{ memoryId?: unknown; title?: unknown; date?: unknown; location?: unknown }>
}

function aiError(response: { message?: string }, fallback: string): Error {
  return new Error(response.message || fallback)
}

async function supabaseAiError(error: unknown): Promise<Error> {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : undefined
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { ok?: unknown; message?: unknown }
      if (body?.ok === false && typeof body.message === 'string' && body.message.trim()) {
        return new Error(body.message)
      }
    } catch {
      // 网关错误可能没有 JSON 响应体，按状态码给出提示。
    }
    if (context.status === 401) return new Error('登录状态无效，请重新登录')
    if (context.status === 403) return new Error('你不在这个情侣空间里')
    if (context.status === 404) return new Error('AI 服务暂未启用，请稍后再试')
  }
  return new Error('AI 服务暂时无法连接，请稍后再试')
}

async function callAiFunction<T extends AiAccessResponse>(input: Record<string, unknown>): Promise<T> {
  let response: T | null
  if (dataProvider === 'cloudbase') {
    const { callCloudFunction } = await import('./cloudbase')
    response = await callCloudFunction<T>('aiAccess', input)
  } else if (dataProvider === 'supabase') {
    const { requireSupabase } = await import('./supabase')
    const { data, error } = await requireSupabase().functions.invoke<T>('aiAccess', { body: input })
    if (error) throw await supabaseAiError(error)
    response = data
  } else {
    throw new Error('AI 助手需要登录双人云端空间后使用')
  }
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    throw new Error('AI 服务返回异常，请稍后再试')
  }
  return response
}

/** 写回忆助手：正文 + 照片元数据 → 标题/润色文字/版式/模板/标签/照片说明。 */
export async function aiCompose(coupleId: string, input: AiComposeInput): Promise<AiComposeResult> {
  const response = await callAiFunction<AiAccessResponse>({
    action: 'compose',
    coupleId,
    ...aiTuning(),
    text: input.text,
    location: input.location || '',
    moodEmoji: input.moodEmoji || '',
    category: input.category || '',
    photoCount: input.photoCount || 0,
    hasPortrait: Boolean(input.hasPortrait),
  })
  if (!response.ok) throw aiError(response, 'AI 排版失败，请稍后再试')
  return {
    title: response.title || '',
    text: response.text || '',
    style: (response.style as LayoutStyle) || 'cream',
    template: (response.template as LayoutTemplate) || 'hero-note',
    tags: Array.isArray(response.tags) ? response.tags.map(String) : [],
    photoNote: response.photoNote || '',
  }
}

/** 排版对话增量字段（AI 指挥修改草稿时返回的 updates）。 */
export interface AiEditUpdates {
  title?: string
  text?: string
  style?: LayoutStyle
  template?: LayoutTemplate
  tags?: string[]
  category?: string
  location?: string
  moodEmoji?: string
  moodText?: string
}

export interface AiEditResult {
  reply: string
  updates: AiEditUpdates
}

/** 排版对话：把当前草稿和用户指令发给 AI，拿回改动增量（未提及字段不出现）。 */
export async function aiEdit(coupleId: string, instruction: string, current: Record<string, unknown>): Promise<AiEditResult> {
  const response = await callAiFunction<AiAccessResponse & { reply?: string; updates?: AiEditUpdates }>({
    action: 'edit',
    coupleId,
    ...aiTuning(),
    instruction,
    current,
  })
  if (!response.ok) throw aiError(response, 'AI 助手暂时走神了，请再试一次')
  return {
    reply: response.reply || '已经按你的想法调整好了',
    updates: response.updates && typeof response.updates === 'object' ? response.updates : {},
  }
}

/** 回忆问答：只从两个人的回忆里找答案。 */
export async function aiChat(coupleId: string, question: string): Promise<string> {
  const response = await callAiFunction<AiAccessResponse>({
    action: 'chat',
    coupleId,
    ...aiTuning(),
    question,
  })
  if (!response.ok) throw aiError(response, '回忆助手暂时走神了，请再问一次')
  return response.answer || '我一时没想好，再问我一次吧。'
}

/** 每日一问：AI 从回忆里挑一个今天值得问的问题。 */
export async function aiSuggest(coupleId: string): Promise<string> {
  const response = await callAiFunction<AiAccessResponse>({
    action: 'suggest',
    coupleId,
    ...aiTuning(),
  })
  if (!response.ok) throw aiError(response, '今天的问题还没想好，晚点再试试')
  return response.question || ''
}

export interface AiBlessingInput {
  occasionTitle: string
  names: string[]
  daysTogether?: number
}

/** 纪念文案：给纪念日写一段祝福。 */
export async function aiBlessing(coupleId: string, input: AiBlessingInput): Promise<string> {
  const response = await callAiFunction<AiAccessResponse>({
    action: 'blessing',
    coupleId,
    ...aiTuning(),
    occasionTitle: input.occasionTitle,
    names: input.names,
    daysTogether: input.daysTogether || 0,
  })
  if (!response.ok) throw aiError(response, '祝福生成失败，请稍后再试')
  return response.blessing || ''
}

export interface AiSearchMatch {
  memoryId: string
  title: string
  date: string
  location: string
}

export interface AiSearchResult {
  matches: AiSearchMatch[]
  reply: string
}

/** AI 搜索：理解模糊描述，从回忆里挑出最相关的几条。 */
export async function aiSearch(coupleId: string, query: string): Promise<AiSearchResult> {
  const response = await callAiFunction<AiAccessResponse>({
    action: 'search',
    coupleId,
    ...aiTuning(),
    query,
  })
  if (!response.ok) throw aiError(response, 'AI 搜索暂时不可用，请稍后再试')
  return {
    matches: (response.matches || []).map((match) => ({
      memoryId: String(match.memoryId || ''),
      title: String(match.title || ''),
      date: String(match.date || ''),
      location: String(match.location || ''),
    })),
    reply: response.reply || (response.matches?.length ? `找到 ${response.matches.length} 段相关回忆` : '没有找到特别相关的回忆'),
  }
}
