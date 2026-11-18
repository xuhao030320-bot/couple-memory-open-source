'use strict'

const assert = require('node:assert/strict')
const {
  canViewMessage,
  normalizeRevealAt,
  normalizeText,
  visibleMessages,
} = require('./logic')

const now = Date.parse('2026-08-16T12:00:00.000Z')
const future = '2026-08-17T12:00:00.000Z'
const past = '2026-08-15T12:00:00.000Z'
const secret = {
  _id: 'message-1',
  coupleId: 'couple-secret',
  createdBy: 'sender',
  text: '这是未揭晓原文',
  revealAt: future,
  createdAt: '2026-08-16T10:00:00.000Z',
  replies: [{ id: 'reply-1', createdBy: 'sender', text: '秘密回复', createdAt: '2026-08-16T11:00:00.000Z' }],
  internalOnly: '不应返回',
}

assert.equal(canViewMessage(secret, 'sender', now), true, '发送方应始终可见')
assert.equal(canViewMessage(secret, 'receiver', now), false, '接收方不应提前可见')

const senderResult = visibleMessages([secret], 'sender', now)
assert.equal(senderResult.length, 1)
assert.equal(senderResult[0].text, secret.text)
assert.equal(senderResult[0].internalOnly, undefined, '返回值应使用字段白名单')

const receiverBeforeReveal = visibleMessages([secret], 'receiver', now)
assert.deepEqual(receiverBeforeReveal, [])
assert.equal(JSON.stringify(receiverBeforeReveal).includes(secret.text), false, '响应中不得出现未揭晓原文')
assert.equal(JSON.stringify(receiverBeforeReveal).includes('秘密回复'), false, '响应中不得出现未揭晓回复')

const receiverAfterReveal = visibleMessages([{ ...secret, revealAt: past }], 'receiver', now)
assert.equal(receiverAfterReveal.length, 1)
assert.equal(receiverAfterReveal[0].text, secret.text)

const invalidOldData = { ...secret, revealAt: 'not-a-date' }
assert.equal(canViewMessage(invalidOldData, 'receiver', now), false, '非法时间对接收方应 fail closed')
assert.equal(canViewMessage(invalidOldData, 'sender', now), true, '非法时间不应锁住发送方')

assert.equal(normalizeRevealAt(null), null)
assert.equal(normalizeRevealAt(past), past)
assert.throws(() => normalizeRevealAt('not-a-date'), /INVALID_REVEAL_AT/)
assert.equal(normalizeText('  晚安  '), '晚安')
assert.throws(() => normalizeText(''), /INVALID_TEXT/)
assert.throws(() => normalizeText('x'.repeat(501)), /INVALID_TEXT/)

console.log('messageAccess logic: all assertions passed')
