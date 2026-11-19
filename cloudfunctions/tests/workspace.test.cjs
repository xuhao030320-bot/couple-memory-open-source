const assert = require('node:assert/strict')
const test = require('node:test')
const { findValidWorkspace, isCanonicalMembership } = require('../getMyWorkspace/workspace')

function fakeDb(members, couples) {
  return {
    collection(name) {
      if (name === 'couples') {
        return {
          doc(id) {
            return {
              async get() {
                return { data: couples[id] || [] }
              },
            }
          },
        }
      }
      if (name !== 'couple_members') throw new Error(`unexpected collection: ${name}`)
      return {
        where(filter) {
          const matched = members.filter((member) => member.userId === filter.userId)
          let offset = 0
          let size = 100
          const query = {
            skip(value) {
              offset = value
              return query
            },
            limit(value) {
              size = value
              return query
            },
            async get() {
              return { data: matched.slice(offset, offset + size) }
            },
          }
          return query
        },
      }
    },
  }
}

test('rejects a one-way or non-canonical membership', () => {
  const couple = { _id: 'real', memberIds: ['user-a'] }
  assert.equal(isCanonicalMembership({ _id: 'forged', coupleId: 'real', userId: 'user-a' }, couple, 'user-a'), false)
  assert.equal(isCanonicalMembership({ _id: 'real_user-a', coupleId: 'real', userId: 'user-a' }, couple, 'user-a'), true)
  assert.equal(isCanonicalMembership({ _id: 'real_user-b', coupleId: 'real', userId: 'user-b' }, couple, 'user-b'), false)
})

test('skips forged records before the real workspace', async () => {
  const db = fakeDb([
    { _id: 'other_user-a', coupleId: 'other', userId: 'user-a', displayName: '伪记录' },
    { _id: 'real_user-a', coupleId: 'real', userId: 'user-a', displayName: '小满' },
  ], {
    other: { _id: 'other', memberIds: ['someone-else'] },
    real: { _id: 'real', memberIds: ['user-a', 'user-b'] },
  })

  const workspace = await findValidWorkspace(db, 'user-a')
  assert.equal(workspace.member.coupleId, 'real')
  assert.equal(workspace.couple._id, 'real')
})

test('continues past the first 100 forged records', async () => {
  const forged = Array.from({ length: 100 }, (_, index) => ({
    _id: `fake-${index}_user-a`,
    coupleId: `fake-${index}`,
    userId: 'user-a',
  }))
  const real = { _id: 'real_user-a', coupleId: 'real', userId: 'user-a' }
  const couples = Object.fromEntries(forged.map((member) => [member.coupleId, {
    _id: member.coupleId,
    memberIds: ['someone-else'],
  }]))
  couples.real = { _id: 'real', memberIds: ['user-a'] }

  const workspace = await findValidWorkspace(fakeDb([...forged, real], couples), 'user-a')
  assert.equal(workspace.member._id, 'real_user-a')
})
