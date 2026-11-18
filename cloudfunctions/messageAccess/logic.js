'use strict'

const MESSAGE_TEXT_MAX_LENGTH = 500
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

function timestampOf(value) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value.toDate === 'function') return value.toDate().getTime()
  if (value && typeof value === 'object' && '$date' in value) {
    return new Date(value.$date).getTime()
  }
  return new Date(value).getTime()
}

function isoOrEmpty(value) {
  const timestamp = timestampOf(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
}

/**
 * 空值表示立即揭晓；非法时间一律拒绝，避免因客户端输入异常而意外公开。
 */
function normalizeRevealAt(value) {
  if (value === null || value === undefined || value === '') return null
  const timestamp = timestampOf(value)
  if (!Number.isFinite(timestamp)) throw new Error('INVALID_REVEAL_AT')
  return new Date(timestamp).toISOString()
}

function normalizeText(value) {
  const text = String(value || '').trim()
  if (!text || text.length > MESSAGE_TEXT_MAX_LENGTH) throw new Error('INVALID_TEXT')
  return text
}

function normalizeId(value) {
  const id = String(value || '')
  if (!MESSAGE_ID_PATTERN.test(id)) throw new Error('INVALID_ID')
  return id
}

/**
 * 安全语义：发送者永远能看自己的留言；接收者只能在有效 revealAt 到期后看到。
 * 老数据如果 revealAt 非法，对接收者按“未揭晓”处理（fail closed）。
 */
function canViewMessage(message, userId, now = Date.now()) {
  if (String(message.createdBy || '') === userId) return true
  if (message.revealAt === null || message.revealAt === undefined || message.revealAt === '') return true
  const revealTimestamp = timestampOf(message.revealAt)
  return Number.isFinite(revealTimestamp) && revealTimestamp <= now
}

function publicReply(reply) {
  return {
    id: String(reply.id || ''),
    createdBy: String(reply.createdBy || ''),
    text: String(reply.text || ''),
    createdAt: isoOrEmpty(reply.createdAt),
  }
}

function publicMessage(message) {
  return {
    id: String(message._id || message.id || ''),
    createdBy: String(message.createdBy || ''),
    text: String(message.text || ''),
    revealAt: message.revealAt ? isoOrEmpty(message.revealAt) || null : null,
    createdAt: isoOrEmpty(message.createdAt),
    replies: Array.isArray(message.replies) ? message.replies.map(publicReply) : [],
  }
}

function visibleMessages(messages, userId, now = Date.now()) {
  return messages
    .filter((message) => canViewMessage(message, userId, now))
    .map(publicMessage)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

module.exports = {
  canViewMessage,
  normalizeId,
  normalizeRevealAt,
  normalizeText,
  publicMessage,
  visibleMessages,
}
