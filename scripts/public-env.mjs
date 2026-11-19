import { Buffer } from 'node:buffer'

function hasPrivilegedClaims(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return claims?.is_system_admin === true || claims?.role === 'service_role'
  } catch {
    return false
  }
}

// Vite embeds VITE_* values in browser assets. Never print the value in an error.
function isCustomLoginKey(value) {
  try {
    const json = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8')
    if (!json.trimStart().startsWith('{')) return false
    return typeof JSON.parse(json).private_key === 'string'
  } catch {
    return false
  }
}

export function checkPublicEnv(env) {
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !raw?.trim()) continue
    const value = raw.trim()
    const serverOnlyName = /(?:^|_)(?:SERVICE_ROLE|SECRET|PRIVATE_KEY|CUSTOM_LOGIN_KEY|PASSWORD|DEEPSEEK_API_KEY|OPENAI_API_KEY)(?:_|$)/i
    if (serverOnlyName.test(name) || /^(?:sb_secret_|sbp_|sk-)/.test(value) || hasPrivilegedClaims(value) || isCustomLoginKey(value)) {
      throw new Error(`${name} 含服务端凭据，已停止启动或构建。请从前端环境中移除该配置。`)
    }
  }
}
