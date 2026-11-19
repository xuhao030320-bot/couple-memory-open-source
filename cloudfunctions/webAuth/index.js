// 邮箱密码由云函数校验，浏览器只收到 CloudBase 自定义登录票据。
const { createHash } = require('node:crypto')
const bcrypt = require('bcryptjs')
const cloudbase = require('@cloudbase/node-sdk')

const db = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database()
const users = db.collection('users')
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function signTicket(userId) {
  const credentials = JSON.parse(Buffer.from(process.env.TCB_CUSTOM_LOGIN_KEY || '', 'base64').toString('utf8'))
  const env = process.env.TCB_ENV || process.env.SCF_NAMESPACE
  if (env && env !== credentials.env_id) throw new Error('自定义登录私钥所属环境不匹配')
  return cloudbase.init({ env: credentials.env_id, credentials }).auth().createTicket(userId)
}

async function findAccount(id) {
  const result = await users.doc(id).get()
  if (result.code) throw new Error('读取账号失败')
  return Array.isArray(result.data) ? result.data[0] : result.data
}

exports.main = async (event = {}) => {
  const { action } = event
  if (action !== 'register' && action !== 'login') {
    return { ok: false, code: 'UNKNOWN_ACTION', message: '未知操作' }
  }
  const email = String(event.email || '').trim().toLowerCase()
  const password = String(event.password || '')
  if (email.length > 254 || !emailPattern.test(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: '邮箱格式不正确' }
  }
  if (password.length < 6 || password.length > 64 || (action === 'register' && bcrypt.truncates(password))) {
    return { ok: false, code: 'INVALID_PASSWORD', message: '密码需要 6 到 64 位，注册时 UTF-8 编码最多 72 字节' }
  }

  // 保持与现有网页登录一致的确定性用户 ID。
  const userId = 'u_' + createHash('sha256').update(email).digest('hex').slice(0, 28)
  try {
    if (action === 'register') {
      const displayName = (String(event.displayName || '').trim() || email.split('@')[0]).slice(0, 20)
      const passwordHash = await bcrypt.hash(password, 10)
      const ticket = await signTicket(userId)
      const now = db.serverDate()
      try {
        // 只允许插入。并发注册同一邮箱时，唯一的文档 ID 会阻止覆盖密码。
        const result = await users.add({ _id: userId, email, displayName, passwordHash, createdAt: now, updatedAt: now })
        if (result.id !== userId) throw new Error('创建账号失败')
      } catch (error) {
        if ((await findAccount(userId))?._id === userId) {
          return { ok: false, code: 'USER_EXISTS', message: '这个邮箱已经注册，可以直接登录' }
        }
        throw error
      }
      return { ok: true, ticket, displayName }
    }
    const account = await findAccount(userId)
    if (!account?.passwordHash || !await bcrypt.compare(password, account.passwordHash)) {
      return { ok: false, code: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确' }
    }
    return { ok: true, ticket: await signTicket(userId), displayName: account.displayName || email.split('@')[0] }
  } catch {
    return { ok: false, code: 'INTERNAL', message: '认证服务暂时不可用，请检查自定义登录配置后重试' }
  }
}
