// AI 助手安全网关：写回忆助手 / 回忆问答 / 纪念文案。
// 仅空间成员可调用（双重校验），DeepSeek 密钥只存在于本函数的环境变量，
// 前端拿不到；所有返回内容都经过长度与格式兜底。
const https = require('https')
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const DEEPSEEK_API_URL = 'api.deepseek.com'
const MODEL_MAP = {
  flash: 'deepseek-v4-flash',
  pro: 'deepseek-v4-pro',
}
// 推理强度：low 用低温度（快、省），high/xhigh 走 V4 的思考强度
const STRENGTH = {
  low: { temperature: 0.3 },
  high: { reasoning_effort: 'high' },
  xhigh: { reasoning_effort: 'max' },
}
const MAX_MEMORIES_FOR_CHAT = 40
const MAX_TEXT_LENGTH = 4000
const MAX_ANSWER_LENGTH = 1200

const STYLE_OPTIONS = ['cream', 'film', 'minimal', 'ticket']
const TEMPLATE_OPTIONS = ['hero-note', 'hero-grid', 'film-strip', 'quiet-column', 'grid-4', 'grid-6', 'grid-9']

class AccessError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function resolveBoundCustomUserId(openId) {
  try {
    const result = await db.collection('users').where({ openId }).limit(1).get()
    const doc = Array.isArray(result.data) ? result.data[0] : (result.data || null)
    return doc && doc._id ? String(doc._id) : ''
  } catch (error) {
    console.warn('aiAccess 查询账号绑定关系失败', error)
    return ''
  }
}

async function currentUserId() {
  try {
    const info = app.auth().getUserInfo()
    if (info.isAnonymous) return ''
    if (info.customUserId) return info.customUserId
    const openId = info.openId || ''
    if (openId) {
      const bound = await resolveBoundCustomUserId(openId)
      if (bound) return bound
    }
    return info.uid || ''
  } catch (error) {
    console.warn('aiAccess getUserInfo 失败', error)
    return ''
  }
}

function docData(result) {
  const data = result && result.data
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' && Object.keys(data).length ? data : null
}

function requiredId(value, fieldName) {
  const id = String(value || '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new AccessError('INVALID_INPUT', `${fieldName}格式不正确`)
  }
  return id
}

async function requireMember(userId, coupleId) {
  const result = await db.collection('couples').doc(coupleId).get().catch(() => null)
  const couple = docData(result)
  if (!couple || !Array.isArray(couple.memberIds) || !couple.memberIds.includes(userId)) {
    throw new AccessError('FORBIDDEN', '你不在这个情侣空间里')
  }
  const membership = await db.collection('couple_members')
    .where({ coupleId, userId })
    .limit(1)
    .get()
  if (!membership.data || membership.data.length === 0) {
    throw new AccessError('FORBIDDEN', '情侣空间成员信息不完整')
  }
  return couple
}

/** 使用服务端密钥请求 DeepSeek。 */
function callDeepSeek(messages, jsonMode = false, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) {
    throw new AccessError('NOT_CONFIGURED', 'AI 服务还没有配置好')
  }
  const model = MODEL_MAP[options.model] || MODEL_MAP.flash
  const strength = STRENGTH[options.strength] || STRENGTH.low
  const payload = JSON.stringify({
    model,
    messages,
    max_tokens: 1600,
    ...strength,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  })
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: DEEPSEEK_API_URL,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`AI 服务返回 ${response.statusCode}`))
          return
        }
        try {
          const parsed = JSON.parse(body)
          const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
            ? String(parsed.choices[0].message.content || '')
            : ''
          resolve(content)
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('AI 服务响应超时')))
    request.on('error', reject)
    request.end(payload)
  })
}

function clampText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function pickOption(value, options, fallback) {
  return options.includes(value) ? value : fallback
}

/** 写回忆助手：正文+照片元数据 → 标题/润色/版式/模板/标签。 */
async function composeMemory(event) {
  const text = clampText(event.text || event.originalText, MAX_TEXT_LENGTH)
  if (!text) {
    throw new AccessError('INVALID_INPUT', '先写一点内容，AI 才能帮你排版')
  }
  const photoCount = Math.max(0, Math.min(9, Number(event.photoCount) || 0))
  const hasPortrait = Boolean(event.hasPortrait)
  const location = clampText(event.location, 60)
  const moodEmoji = clampText(event.moodEmoji, 8)
  const category = clampText(event.category, 20)

  const prompt = [
    '你是情侣回忆手账「只此我们」的排版助手。请根据下面的内容生成一份温暖的回忆排版建议。',
    `正文：${text}`,
    `地点：${location || '未填写'}`,
    `分类：${category || '日常'}`,
    `心情：${moodEmoji || '未填写'}`,
    `照片数量：${photoCount}${hasPortrait ? '，其中含竖屏照片' : ''}`,
    '',
    '要求：',
    '1. title：15 字以内的温暖标题；',
    '2. text：把正文润色成第一人称、有画面感的手账文字（保留原意，200 字以内）；',
    '3. style：从 cream(奶油手账)/film(暮色胶片)/minimal(清透留白)/ticket(旅途票根) 中选一个；',
    '4. template：从 hero-note(大图手账)/hero-grid(照片网格)/film-strip(照片轨)/quiet-column(静谧单列)/grid-4(四宫格)/grid-6(六宫格)/grid-9(九宫格) 中选一个（照片正好 4 张优先 grid-4，5~6 张优先 grid-6，7 张及以上优先 grid-9，3 张优先 hero-grid，1 张优先 hero-note，0 张优先 quiet-column）；',
    '5. tags：1~3 个短标签（不含分类名，如 一起去过/第一次/美食）；',
    '6. photoNote：一句话的照片排版说明（30 字以内，例如「竖屏照片放主位，留白更有呼吸感」）。',
    '',
    '只输出 JSON：{"title":"...","text":"...","style":"...","template":"...","tags":["..."],"photoNote":"..."}',
  ].join('\n')

  const content = await callDeepSeek([{ role: 'user', content: prompt }], true, { model: event.model, strength: event.strength })
  let parsed = null
  try { parsed = JSON.parse(content) } catch { /* 模型偶尔不守规矩，走兜底 */ }
  const result = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    title: clampText(result.title, 40) || text.slice(0, 12),
    text: clampText(result.text, 2000) || text,
    style: pickOption(result.style, STYLE_OPTIONS, 'cream'),
    template: pickOption(result.template, TEMPLATE_OPTIONS, photoCount >= 3 ? 'hero-grid' : photoCount ? 'hero-note' : 'quiet-column'),
    tags: (Array.isArray(result.tags) ? result.tags : []).map((tag) => clampText(tag, 12)).filter(Boolean).slice(0, 3),
    photoNote: clampText(result.photoNote, 60),
  }
}

/** 排版对话：用户在写回忆页指挥 AI 修改草稿，AI 返回改动增量。 */
async function editMemoryDraft(event) {
  const instruction = clampText(event.instruction, 200)
  if (!instruction) {
    throw new AccessError('INVALID_INPUT', '想让我怎么改？')
  }
  const current = event.current && typeof event.current === 'object' ? event.current : {}
  const brief = [
    `标题：${clampText(current.title, 40) || '未填写'}`,
    `正文：${clampText(current.text, 2000) || '未填写'}`,
    `地点：${clampText(current.location, 60) || '未填写'}`,
    `分类：${clampText(current.category, 20) || '未填写'}`,
    `心情：${clampText(current.moodEmoji, 8) || '未填写'} ${clampText(current.moodText, 20)}`,
    `版式 style：${clampText(current.style, 20) || 'cream'}，模板 template：${clampText(current.template, 20) || 'hero-note'}`,
    `标签：${Array.isArray(current.tags) ? current.tags.map((tag) => clampText(tag, 12)).join('、') : ''}`,
    `照片数量：${Math.max(0, Math.min(9, Number(current.photoCount) || 0))}`,
  ].join('\n')

  const prompt = [
    '你是情侣回忆手账「只此我们」的排版助手，用户在写回忆页上指挥你修改草稿。',
    `当前草稿：\n${brief}`,
    '',
    `用户的指令：${instruction}`,
    '',
    '只输出 JSON：{"reply":"一句简短回应（40 字以内）","updates":{...}}',
    'updates 只包含需要修改的字段，可选字段名：title, text, style, template, tags, category, location, moodEmoji, moodText。',
    '规则：只改用户明确要求的字段，没提到的字段不要出现在 updates 里；',
    'style 只能从 cream/film/minimal/ticket 选，template 只能从 hero-note/hero-grid/film-strip/quiet-column/grid-4/grid-6/grid-9 选；',
    'tags 是字符串数组（1~3 个，每个 12 字以内）；',
    '用户问问题（不改草稿）时 updates 留空对象，在 reply 里回答。',
  ].join('\n')

  const content = await callDeepSeek([{ role: 'user', content: prompt }], true, { model: event.model, strength: event.strength })
  let parsed = null
  try { parsed = JSON.parse(content) } catch { /* 兜底 */ }
  const result = parsed && typeof parsed === 'object' ? parsed : {}
  const updatesRaw = result.updates && typeof result.updates === 'object' ? result.updates : {}
  const updates = {}
  if (typeof updatesRaw.title === 'string') updates.title = clampText(updatesRaw.title, 40)
  if (typeof updatesRaw.text === 'string') updates.text = clampText(updatesRaw.text, 2000)
  if (typeof updatesRaw.location === 'string') updates.location = clampText(updatesRaw.location, 60)
  if (typeof updatesRaw.category === 'string') updates.category = clampText(updatesRaw.category, 20)
  if (typeof updatesRaw.moodEmoji === 'string') updates.moodEmoji = clampText(updatesRaw.moodEmoji, 8)
  if (typeof updatesRaw.moodText === 'string') updates.moodText = clampText(updatesRaw.moodText, 20)
  if (STYLE_OPTIONS.includes(updatesRaw.style)) updates.style = updatesRaw.style
  if (TEMPLATE_OPTIONS.includes(updatesRaw.template)) updates.template = updatesRaw.template
  if (Array.isArray(updatesRaw.tags)) {
    updates.tags = updatesRaw.tags.map((tag) => clampText(tag, 12)).filter(Boolean).slice(0, 3)
  }
  return {
    reply: clampText(result.reply, 80) || '已经按你的想法调整好了',
    updates,
  }
}

/** 回忆问答：只从两人的回忆里找答案，不知道就直说。 */
async function chatAboutMemories(coupleId, event) {
  const questionText = clampText(event.question, 200)
  if (!questionText) {
    throw new AccessError('INVALID_INPUT', '想问点什么？')
  }
  const memories = []
  let skip = 0
  for (;;) {
    const page = await db.collection('memories')
      .where({ coupleId })
      .skip(skip)
      .limit(100)
      .get()
    const docs = page.data || []
    memories.push(...docs)
    if (docs.length < 100) break
    skip += 100
  }
  memories.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))

  const context = memories.slice(0, MAX_MEMORIES_FOR_CHAT).map((memory, index) => (
    `${index + 1}. ${memory.date}「${String(memory.title || '')}」${memory.location ? `（${memory.location}）` : ''}：${String(memory.displayText || memory.originalText || '').slice(0, 120)}`
  )).join('\n')

  const prompt = [
    '你是情侣回忆手账「只此我们」里的回忆助手，语气温暖亲切。',
    '下面是你拥有的全部回忆记录（按时间倒序）：',
    context || '（还没有任何回忆）',
    '',
    `问题：${questionText}`,
    '',
    '要求：只根据上述回忆回答；回忆里没有的信息就坦白说"我们的手账里还没记过这个"；回答不超过 150 字；不要编造。',
  ].join('\n')

  const answer = await callDeepSeek([{ role: 'user', content: prompt }], false, { model: event.model, strength: event.strength })
  return clampText(answer, MAX_ANSWER_LENGTH) || '我一时没想好，再问我一次吧。'
}

/** AI 搜索：理解用户的模糊查询，从回忆里挑出最相关的条目。 */
async function searchMemories(coupleId, event) {
  const queryText = clampText(event.query, 100)
  if (!queryText) {
    throw new AccessError('INVALID_INPUT', '想找哪段回忆？')
  }
  const memories = []
  let skip = 0
  for (;;) {
    const page = await db.collection('memories')
      .where({ coupleId })
      .skip(skip)
      .limit(100)
      .get()
    const docs = page.data || []
    memories.push(...docs)
    if (docs.length < 100) break
    skip += 100
  }
  if (memories.length === 0) {
    return { matches: [], reply: '手账里还没有回忆可以找。' }
  }
  memories.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))

  const summary = memories.map((memory, index) => (
    `${index + 1}. ${memory.date}「${String(memory.title || '')}」${memory.location ? `（${memory.location}）` : ''}：${String(memory.displayText || memory.originalText || '').slice(0, 80)}`
  )).join('\n')

  const prompt = [
    '你是情侣回忆手账「只此我们」的搜索助手。',
    '用户的查询可能很模糊（比如「去年夏天在海边那次」），请理解意图，从下面的回忆里挑出最相关的 0~5 条。',
    '回忆列表：',
    summary,
    '',
    `用户查询：${queryText}`,
    '',
    '只输出 JSON：{"ids":[数字序号...],"reply":"一句话告诉用户你找到了什么（40 字以内）"}',
    '找不到相关回忆时 ids 为空数组，reply 里友好说明。不要编造不存在的回忆。',
  ].join('\n')

  const content = await callDeepSeek([{ role: 'user', content: prompt }], true, { model: event.model, strength: event.strength })
  let parsed = null
  try { parsed = JSON.parse(content) } catch { /* 兜底 */ }
  const result = parsed && typeof parsed === 'object' ? parsed : {}
  const idSet = new Set((Array.isArray(result.ids) ? result.ids : []).map(Number).filter((num) => Number.isFinite(num) && num >= 1 && num <= memories.length))
  const matches = [...idSet].slice(0, 5).map((num) => {
    const memory = memories[num - 1]
    return {
      memoryId: String(memory._id || ''),
      title: String(memory.title || ''),
      date: String(memory.date || ''),
      location: String(memory.location || ''),
    }
  })
  return { matches, reply: clampText(result.reply, 80) || (matches.length ? `找到 ${matches.length} 段相关回忆` : '没有找到特别相关的回忆') }
}

/** 每日一问：从回忆里挑一个今天值得问的问题（网页端按日期缓存，每天只判断一次）。 */
async function suggestQuestion(coupleId, event) {
  const memories = []
  let skip = 0
  for (;;) {
    const page = await db.collection('memories')
      .where({ coupleId })
      .skip(skip)
      .limit(100)
      .get()
    const docs = page.data || []
    memories.push(...docs)
    if (docs.length < 100) break
    skip += 100
  }
  memories.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))

  const digest = memories.map((memory, index) => (
    `${index + 1}. ${memory.date}「${String(memory.title || '')}」${memory.location ? `（${memory.location}）` : ''}：${String(memory.displayText || memory.originalText || '').slice(0, 60)}`
  )).join('\n')

  const prompt = [
    '你是情侣回忆手账「只此我们」里的回忆助手。',
    '下面是两人的回忆记录（按时间倒序）：',
    digest || '（还没有任何回忆）',
    '',
    '请挑一个今天最值得问你的问题（用户会拿它来问你），风格参考：「我们第一次去旅行是什么时候？」「最喜欢一起吃的东西是什么？」',
    '要求：问题必须能在上述回忆里找到线索；优先围绕有具体地点、日期或细节的回忆；每天换一个角度（回忆细节、两人的小习惯、时间线总结都可以），不要总是同一种问法；',
    '只输出 JSON：{"question":"...","reason":"一句话说明为什么选它（20字以内）"}',
  ].join('\n')

  const content = await callDeepSeek([{ role: 'user', content: prompt }], true, { model: event.model, strength: event.strength })
  let parsed = null
  try { parsed = JSON.parse(content) } catch { /* 兜底 */ }
  const result = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    question: clampText(result.question, 60) || '我们第一次一起出去玩是什么时候？',
    reason: clampText(result.reason, 30),
  }
}

/** 纪念文案：给纪念日写一段祝福。 */
async function blessingFor(event) {
  const occasion = clampText(event.occasionTitle, 40) || '我们的纪念日'
  const names = Array.isArray(event.names) ? event.names.map((name) => clampText(name, 20)).filter(Boolean) : []
  const daysTogether = Math.max(0, Number(event.daysTogether) || 0)

  const prompt = [
    '你是情侣回忆手账「只此我们」的文案助手。',
    `请为「${occasion}」写一段 60~100 字的祝福/情话，送给${names.length >= 2 ? ` ${names[0]} 和 ${names[1]}` : '两个人'}${daysTogether ? `（在一起 ${daysTogether} 天）` : ''}。`,
    '要求：温柔、真诚、有画面感，不要空话套话，不要表情符号，直接输出文案本身。',
  ].join('\n')

  const blessing = await callDeepSeek([{ role: 'user', content: prompt }], false, { model: event.model, strength: event.strength })
  return clampText(blessing, 300) || `愿「${occasion}」的这一天，永远被你们好好收藏。`
}

exports.main = async (event = {}) => {
  const userId = await currentUserId()
  if (!userId) return { ok: false, code: 'UNAUTHENTICATED', message: '登录状态无效，请重新登录' }

  try {
    const action = String(event.action || '')
    const coupleId = requiredId(event.coupleId, '情侣空间 ID')
    await requireMember(userId, coupleId)

    if (action === 'compose') {
      return { ok: true, ...(await composeMemory(event)) }
    }
    if (action === 'chat') {
      return { ok: true, answer: await chatAboutMemories(coupleId, event) }
    }
    if (action === 'blessing') {
      return { ok: true, blessing: await blessingFor(event) }
    }
    if (action === 'search') {
      return { ok: true, ...(await searchMemories(coupleId, event)) }
    }
    if (action === 'edit') {
      return { ok: true, ...(await editMemoryDraft(event)) }
    }
    if (action === 'suggest') {
      return { ok: true, ...(await suggestQuestion(coupleId, event)) }
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: '未知 AI 操作' }
  } catch (error) {
    if (error instanceof AccessError) {
      return { ok: false, code: error.code, message: error.message }
    }
    console.error('aiAccess 执行失败', error)
    return { ok: false, code: 'INTERNAL', message: 'AI 服务暂时不可用，请稍后重试' }
  }
}
