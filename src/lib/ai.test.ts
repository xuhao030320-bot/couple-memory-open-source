import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { handleAiRequest } from '../../supabase/functions/aiAccess/handler'

const mocks = vi.hoisted(() => ({
  cloudCall: vi.fn(),
  invoke: vi.fn(),
  client: null as ReturnType<typeof createClient> | null,
}))

vi.mock('./cloudbase', () => ({ callCloudFunction: mocks.cloudCall }))
vi.mock('./supabase', () => ({ requireSupabase: () => mocks.client ?? ({ functions: { invoke: mocks.invoke } }) }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.client = null
  vi.stubGlobal('window', {
    localStorage: { getItem: () => JSON.stringify({ model: 'pro', strength: 'high' }) },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('AI data provider routing', () => {
  it('uses the Supabase session and forwards all six actions to its own backend', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    mocks.invoke.mockResolvedValue({ data: { ok: true, answer: '海边', reply: '已修改' }, error: null })
    const ai = await import('./ai')

    await ai.aiCompose('couple-1', { text: '一起去海边' })
    await ai.aiEdit('couple-1', '换个标题', { title: '海边' })
    expect(await ai.aiChat('couple-1', '去了哪里？')).toBe('海边')
    await ai.aiSuggest('couple-1')
    await ai.aiBlessing('couple-1', { occasionTitle: '周年', names: ['甲', '乙'] })
    await ai.aiSearch('couple-1', '海边')

    expect(mocks.invoke.mock.calls.map(([name, options]) => [name, options.body.action])).toEqual(
      ['compose', 'edit', 'chat', 'suggest', 'blessing', 'search'].map((action) => ['aiAccess', action]),
    )
    expect(mocks.invoke.mock.calls.every(([, options]) => (
      options.body.coupleId === 'couple-1' && options.body.model === 'pro' && options.body.strength === 'high'
    ))).toBe(true)
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })

  it('preserves CloudBase calls when that provider is selected', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'cloudbase')
    mocks.cloudCall.mockResolvedValue({ ok: true, answer: '第一次旅行' })
    const { aiChat } = await import('./ai')

    expect(await aiChat('couple-2', '哪次旅行？')).toBe('第一次旅行')
    expect(mocks.cloudCall).toHaveBeenCalledWith('aiAccess', {
      action: 'chat', coupleId: 'couple-2', question: '哪次旅行？', model: 'pro', strength: 'high',
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rejects local mode without sending data to either cloud', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'local')
    const { aiChat } = await import('./ai')
    await expect(aiChat('local', '去了哪里？')).rejects.toThrow('需要登录双人云端空间')
    expect(mocks.cloudCall).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('keeps the backend failure message instead of treating it as an answer', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    mocks.invoke.mockResolvedValue({ data: { ok: false, message: '你不在这个情侣空间里' }, error: null })
    const { aiChat } = await import('./ai')
    await expect(aiChat('other-couple', '问题')).rejects.toThrow('你不在这个情侣空间里')
  })

  it('reads structured HTTP errors without consuming the original response', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    const context = new Response(JSON.stringify({ ok: false, message: 'AI 服务还没有配置好' }), { status: 503 })
    mocks.invoke.mockResolvedValue({ data: null, error: { context } })
    const { aiChat } = await import('./ai')
    await expect(aiChat('couple-1', '问题')).rejects.toThrow('AI 服务还没有配置好')
    expect(context.bodyUsed).toBe(false)
  })

  it('explains a missing backend when the gateway returns an empty 404', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    mocks.invoke.mockResolvedValue({ data: null, error: { context: new Response('', { status: 404 }) } })
    const { aiChat } = await import('./ai')
    await expect(aiChat('couple-1', '问题')).rejects.toThrow('AI 服务暂未启用')
  })

  it('translates a gateway authentication error into a useful login prompt', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    const context = Response.json({ message: 'Invalid JWT' }, { status: 401 })
    mocks.invoke.mockResolvedValue({ data: null, error: { context } })
    const { aiChat } = await import('./ai')
    await expect(aiChat('couple-1', '问题')).rejects.toThrow('登录状态无效，请重新登录')
  })

  it('rejects malformed successful responses', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    mocks.invoke.mockResolvedValue({ data: { answer: '没有 ok 字段' }, error: null })
    const { aiChat } = await import('./ai')
    await expect(aiChat('couple-1', '问题')).rejects.toThrow('AI 服务返回异常')
  })

  it('connects the actual Supabase SDK to the backend for answers and member rejection', async () => {
    vi.stubEnv('VITE_DATA_PROVIDER', 'supabase')
    const coupleId = '11111111-1111-4111-8111-111111111111'
    const services = {
      authenticate: vi.fn(async (token: string) => token === 'valid-token' ? 'member-1' : null),
      isMember: vi.fn(async (_token: string, requestedCouple: string) => requestedCouple === coupleId),
      memories: vi.fn(async () => []),
      generate: vi.fn(async () => '我们的手账里还没记过这个'),
    }
    const fetcher: typeof fetch = async (input, init) => handleAiRequest(new Request(input, init), services)
    mocks.client = createClient('https://example.supabase.co', 'public-test-key', {
      global: { fetch: fetcher, headers: { Authorization: 'Bearer valid-token' } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { aiChat } = await import('./ai')

    expect(await aiChat(coupleId, '在哪里旅行？')).toBe('我们的手账里还没记过这个')
    await expect(aiChat('22222222-2222-4222-8222-222222222222', '别人的回忆')).rejects.toThrow('你不在这个情侣空间里')
    expect(services.authenticate).toHaveBeenCalledWith('valid-token')
    expect(services.memories).toHaveBeenCalledTimes(1)
    expect(services.generate).toHaveBeenCalledTimes(1)
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })
})
