import { createClient } from 'npm:@supabase/supabase-js@2.111.0'
import { AiAccessError, createDeepSeekGenerator, handleAiRequest } from './handler.ts'

const generate = createDeepSeekGenerator(Deno.env.get('DEEPSEEK_API_KEY') || '')
Deno.serve((request: Request) => {
  // Each request has its own user JWT context; all database queries respect RLS.
  let client: ReturnType<typeof createClient> | undefined
  const userClient = () => {
    if (client) return client
    const url = Deno.env.get('SUPABASE_URL') || ''
    const key = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (!url || !key) throw new AiAccessError('NOT_CONFIGURED', '云端服务还没有配置好', 503)
    client = createClient(url, key, {
      global: { headers: { Authorization: request.headers.get('Authorization') || '' } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return client
  }
  return handleAiRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await userClient().auth.getUser(token)
      return error ? null : data.user?.id || null
    },
    isMember: async (_token, coupleId, userId) => {
      const { data, error } = await userClient().from('couple_members').select('user_id')
        .eq('couple_id', coupleId).eq('user_id', userId).maybeSingle()
      if (error) throw new AiAccessError('INTERNAL', '空间成员信息读取失败，请稍后重试', 500)
      return Boolean(data)
    },
    memories: async (_token, coupleId, limit) => {
      const { data, error } = await userClient().from('memories')
        .select('id,title,memory_date,location,display_text,original_text')
        .eq('couple_id', coupleId).order('memory_date', { ascending: false })
        .order('created_at', { ascending: false }).limit(limit)
      if (error) throw new AiAccessError('INTERNAL', '回忆读取失败，请稍后重试', 500)
      return data || []
    },
    generate,
  })
})
