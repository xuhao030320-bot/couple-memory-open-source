const assert = require('node:assert/strict')
const test = require('node:test')
const { isAuthorizedMember, isValidDate } = require('../updateMyProfile/profile')

test('validates real calendar dates', () => {
  assert.equal(isValidDate('2024-02-29'), true)
  assert.equal(isValidDate('2023-02-29'), false)
  assert.equal(isValidDate('2026-13-01'), false)
  assert.equal(isValidDate('2026-08-16T00:00:00Z'), false)
})

test('requires member and couple to point to each other', () => {
  const couple = { _id: 'cp-a', memberIds: ['user-a', 'user-b'] }
  const member = { _id: 'cp-a_user-a', coupleId: 'cp-a', userId: 'user-a' }
  assert.equal(isAuthorizedMember(couple, member, 'cp-a', 'user-a'), true)
  assert.equal(isAuthorizedMember(couple, { ...member, _id: 'forged' }, 'cp-a', 'user-a'), false)
  assert.equal(isAuthorizedMember({ ...couple, memberIds: ['user-b'] }, member, 'cp-a', 'user-a'), false)
  assert.equal(isAuthorizedMember(couple, { ...member, userId: 'user-b' }, 'cp-a', 'user-a'), false)
})
