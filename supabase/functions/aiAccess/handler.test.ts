import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDeepSeekGenerator, handleAiRequest, MAX_MEMORIES,
  type AiDependencies, type MemoryRecord,
} from './handler'

const coupleId = '11111111-1111-4111-8111-111111111111'
const memories: MemoryRecord[] = [
  { id: 'm1', title: '海边旅行', memory_date: '2026-10-01', location: '厦门', display_text: '一起看日出', original_text: '' },
  { id: 'm2', title: '第一次散步', memory_date: '2026-09-01', location: '江边', display_text: '', original_text: '一起散步' },
]
function request(body: unknown = { action: 'chat', coupleId, question: '我们去了哪里？' }, authorization = 'Bearer valid-token'): Request {
  return new Request('https://example.test/aiAccess', {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function deps(output = '我们一起去了厦门。') {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: output }, finish_reason: 'stop' }] }))
  const generate = vi.fn(createDeepSeekGenerator('server-only-test-key', fetcher))
  const services = {
    authenticate: vi.fn<AiDependencies['authenticate']>().mockImplementation(async (token) => token === 'valid-token' ? 'user-1' : null),
    isMember: vi.fn<AiDependencies['isMember']>().mockResolvedValue(true),
    memories: vi.fn<AiDependencies['memories']>().mockResolvedValue(memories), generate,
  }
  return { services, fetcher }
}

afterEach(() => vi.useRealTimers())

describe('AI authorization and HTTP contract', () => {
  it.each(['', 'Basic valid-token', 'Bearer forged.jwt.signature'])('rejects an invalid identity (%s) before reading members, memories or calling AI', async (authorization) => {
    const { services, fetcher } = deps()
    const response = await handleAiRequest(request(undefined, authorization), services)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(services.isMember).not.toHaveBeenCalled()
    expect(services.memories).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['compose', 'edit', 'chat', 'search', 'suggest', 'blessing'])('refuses a nonmember before %s can read memories or call AI', async (action) => {
    const { services, fetcher } = deps()
    services.isMember.mockResolvedValue(false)
    const response = await handleAiRequest(request({ action, coupleId, text: '一天', question: '哪天？', query: '海', instruction: '改标题' }), services)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(services.isMember).toHaveBeenCalledWith('valid-token', coupleId, 'user-1')
    expect(services.memories).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows unauthenticated CORS preflight and rejects other methods', async () => {
    const { services } = deps()
    const preflight = await handleAiRequest(new Request('https://example.test', { method: 'OPTIONS' }), services)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
    const get = await handleAiRequest(new Request('https://example.test'), services)
    expect(get.status).toBe(405)
    expect(services.authenticate).not.toHaveBeenCalled()
  })

  it.each([null, [], { action: ['chat'], coupleId }, { action: {}, coupleId }, { action: 'chat', coupleId: '../other' }, { action: 'chat', coupleId, model: 'unknown' }, { action: 'chat', coupleId, model: ['pro'] }, { action: 'chat', coupleId, strength: ['high'] }, { action: 'chat', coupleId, question: 42 }])('rejects malformed input %j without calling AI', async (body) => {
    const { services, fetcher } = deps()
    const response = await handleAiRequest(request(body), services)
    expect(response.status).toBe(400)
    expect((await response.json()).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    expect(services.memories).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON, content type and oversized payloads', async () => {
    const { services, fetcher } = deps()
    for (const [body, type] of [['{bad json', 'application/json'], ['{}', 'text/plain'], [' '.repeat(20_001), 'application/json']]) {
      const req = new Request('https://example.test', { method: 'POST', body, headers: { Authorization: 'Bearer valid-token', 'Content-Type': type } })
      const response = await handleAiRequest(req, services)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps internal exception details and secrets out of responses', async () => {
    const { services } = deps()
    services.isMember.mockRejectedValue(new Error('database password is SECRET'))
    const response = await handleAiRequest(request(), services)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'INTERNAL', message: 'AI 服务暂时不可用，请稍后重试' })
  })
})

describe('all six AI actions', () => {
  it('composes a sanitized draft using compatible styles and bounded output', async () => {
    const { services } = deps(JSON.stringify({ title: '长'.repeat(80), text: '润色'.repeat(2000), style: 'invalid', template: 'invalid', tags: [' 一起去过 ', 42, '很长'.repeat(20), '日常', '多余'], photoNote: '说明'.repeat(100) }))
    const response = await handleAiRequest(request({ action: 'compose', coupleId, text: '一起看海', photoCount: 4, hasPortrait: true }), services)
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, style: 'cream', template: 'hero-grid' })
    expect(body.title).toHaveLength(40)
    expect(body.text).toHaveLength(2000)
    expect(body.photoNote).toHaveLength(60)
    expect(body.tags).toEqual(['一起去过', '很长'.repeat(6), '日常'])
    expect(services.memories).not.toHaveBeenCalled()
  })

  it('edits only permitted draft fields and preserves the incremental response shape', async () => {
    const { services } = deps(JSON.stringify({ reply: ' 已改好 ', updates: { title: '新的标题', style: 'film', template: 'grid-4', category: 'travel', location: '上海', tags: ['旅行'], text: 42, coupleId: 'other', arbitrary: true } }))
    const response = await handleAiRequest(request({ action: 'edit', coupleId, instruction: '改标题和版式', current: { title: '旧标题', text: '旧文字', photoCount: 4 } }), services)
    expect(await response.json()).toEqual({ ok: true, reply: '已改好', updates: { title: '新的标题', location: '上海', category: 'travel', style: 'film', template: 'grid-4', tags: ['旅行'] } })
    expect(services.memories).not.toHaveBeenCalled()
  })

  it('drops array and object values used as style or template updates', async () => {
    const { services } = deps(JSON.stringify({ reply: '已改好', updates: { style: ['film'], template: { value: 'grid-4' }, title: '保留标题', category: 'not-a-category' } }))
    const response = await handleAiRequest(request({ action: 'edit', coupleId, instruction: '改版式' }), services)
    expect(await response.json()).toEqual({ ok: true, reply: '已改好', updates: { title: '保留标题' } })
  })

  it.each(['compose', 'edit', 'search', 'suggest'])('rejects an incomplete empty JSON object from %s', async (action) => {
    const { services } = deps('{}')
    const response = await handleAiRequest(request({ action, coupleId, text: '一起看海', instruction: '改标题', query: '旅行' }), services)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_AI_RESPONSE', message: 'AI 返回格式不正确，请重试' })
  })

  it('permits an edit answer that intentionally leaves the draft unchanged', async () => {
    const { services } = deps(JSON.stringify({ reply: '这段文字很适合胶片风格。', updates: {} }))
    const response = await handleAiRequest(request({ action: 'edit', coupleId, instruction: '你觉得适合什么风格？' }), services)
    expect(await response.json()).toEqual({ ok: true, reply: '这段文字很适合胶片风格。', updates: {} })
  })

  it('answers using at most 40 memories from the requested couple', async () => {
    const { services } = deps()
    services.memories.mockResolvedValue([...memories, ...Array.from({ length: 39 }, (_, index) => ({ ...memories[0], id: `extra-${index}`, title: index === 38 ? 'outside-limit-marker' : '另一条' }))])
    const response = await handleAiRequest(request(), services)
    expect(await response.json()).toEqual({ ok: true, answer: '我们一起去了厦门。' })
    expect(services.memories).toHaveBeenCalledWith('valid-token', coupleId, MAX_MEMORIES)
    const prompt = services.generate.mock.calls[0][0][1].content
    expect(prompt).toContain('一起看日出')
    expect(prompt).toContain('一起散步')
    expect(prompt).not.toContain('outside-limit-marker')
  })

  it('searches only authorized memory IDs, dropping fractional, forged and duplicate IDs', async () => {
    const { services } = deps(JSON.stringify({ ids: [1, 1, 2.5, 0, 99, '2', 'forged-memory', 2], reply: ' 找到了 ' }))
    const response = await handleAiRequest(request({ action: 'search', coupleId, query: '旅行' }), services)
    expect(await response.json()).toEqual({ ok: true, matches: [
      { memoryId: 'm1', title: '海边旅行', date: '2026-10-01', location: '厦门' },
      { memoryId: 'm2', title: '第一次散步', date: '2026-09-01', location: '江边' },
    ], reply: '找到了' })
  })

  it('suggests a question grounded in the shared memories', async () => {
    const { services } = deps(JSON.stringify({ question: ' 我们在厦门看到了什么？ ', reason: '旅行中的日出' }))
    const response = await handleAiRequest(request({ action: 'suggest', coupleId }), services)
    expect(await response.json()).toEqual({ ok: true, question: '我们在厦门看到了什么？', reason: '旅行中的日出' })
    expect(services.memories).toHaveBeenCalledWith('valid-token', coupleId, 200)
  })

  it('generates an anniversary blessing with names and days', async () => {
    const { services } = deps('愿我们的每一天都温柔而明亮。')
    const response = await handleAiRequest(request({ action: 'blessing', coupleId, occasionTitle: '两周年', names: ['小明', '小红'], daysTogether: 730 }), services)
    expect(await response.json()).toEqual({ ok: true, blessing: '愿我们的每一天都温柔而明亮。' })
    expect(services.generate.mock.calls[0][0][1].content).toContain('小明和小红，在一起730天')
    expect(services.generate.mock.calls[0][1]).toBe(false)
    expect(services.memories).not.toHaveBeenCalled()
  })

  it.each(['search', 'suggest'])('handles an empty memory collection for %s without spending an AI call', async (action) => {
    const { services, fetcher } = deps()
    services.memories.mockResolvedValue([])
    const response = await handleAiRequest(request({ action, coupleId, query: '旅行' }), services)
    expect((await response.json()).ok).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects malformed structured model output with a readable error', async () => {
    const { services } = deps('not JSON')
    const response = await handleAiRequest(request({ action: 'compose', coupleId, text: '一起看海' }), services)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_AI_RESPONSE', message: 'AI 返回格式不正确，请重试' })
  })
})

describe('DeepSeek transport', () => {
  it.each([
    ['flash', 'low', 'deepseek-v4-flash', { temperature: 0.3 }],
    ['pro', 'high', 'deepseek-v4-pro', { reasoning_effort: 'high' }],
    ['pro', 'xhigh', 'deepseek-v4-pro', { reasoning_effort: 'max' }],
  ] as const)('preserves %s/%s model tuning and JSON mode', async (model, strength, expectedModel, expectedStrength) => {
    const { fetcher } = deps('{}')
    await createDeepSeekGenerator('test-server-key', fetcher)([{ role: 'user', content: 'hello' }], true, { model, strength })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: expectedModel, ...expectedStrength, max_tokens: 1600, response_format: { type: 'json_object' } })
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-server-key')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns 503 when no server API key is configured', async () => {
    const { services, fetcher } = deps()
    services.generate.mockImplementation(createDeepSeekGenerator('', fetcher))
    const response = await handleAiRequest(request(), services)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([new Response('upstream-secret', { status: 429 }), Response.json({ choices: [] }), Response.json({ choices: [{ message: { content: 42 } }] })])('rejects upstream failures and malformed envelopes', async (upstream) => {
    const { services, fetcher } = deps()
    fetcher.mockResolvedValue(upstream)
    const response = await handleAiRequest(request(), services)
    expect(response.status).toBe(502)
    expect((await response.json()).message).not.toContain('upstream-secret')
  })

  it.each(['length', 'content_filter', 'insufficient_system_resource'])('refuses a partial answer terminated with %s', async (finish_reason) => {
    const { services, fetcher } = deps()
    fetcher.mockResolvedValue(Response.json({ choices: [{ message: { content: '这是一段未完成的' }, finish_reason }] }))
    const response = await handleAiRequest(request(), services)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, code: 'INVALID_AI_RESPONSE', message: 'AI 返回内容不完整，请重试' })
  })

  it('aborts slow network requests and releases the timeout', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const result = createDeepSeekGenerator('key', fetcher, 100)([{ role: 'user', content: 'hello' }], false, { model: 'flash', strength: 'low' })
    const assertion = expect(result).rejects.toMatchObject({ code: 'AI_TIMEOUT', status: 504 })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
