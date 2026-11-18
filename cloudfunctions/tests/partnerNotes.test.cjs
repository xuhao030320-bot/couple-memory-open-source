const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../dataAccess/index.js'), 'utf8')

test('pinning is shared, changes only pinned, and preserves original publication metadata', async () => {
  const original = { _id: 'note', coupleId: 'space', text: 'original', kind: 'care', createdAt: '2020-01-02T03:04:05.000Z', createdBy: 'user-b', legacy: false }
  const app = service({ partner_notes: { note: original }, couples: { space: { _id: 'space', memberIds: ['user-a','user-b'], partnerNotesMigrationVersion: 1 } } })
  const result = await app.call('setPartnerNotePinned', { noteId: 'note', pinned: true, note: { text: 'forged' }, createdAt: '2030-01-01' })
  assert.equal(result.ok, true)
  assert.equal(result.partnerNote.pinned, true)
  assert.deepEqual(app.tables.partner_notes.note, { ...original, pinned: true })
  assert.equal((await app.call('setPartnerNotePinned', { noteId: 'note', pinned: false })).ok, true)
  assert.equal(app.tables.partner_notes.note.pinned, false)
  assert.equal((await app.call('setPartnerNotePinned', { noteId: 'note', pinned: 'true' })).code, 'INVALID_INPUT')
})

test('deleting a pinned note archives its exact metadata and is safe to retry', async () => {
  const original = { _id: 'note', coupleId: 'space', text: 'original', kind: 'care', createdAt: null, legacy: true, pinned: true }
  const app = service({ partner_notes: { note: original }, couples: { space: { _id: 'space', memberIds: ['user-a','user-b'], partnerNotesMigrationVersion: 1 } } })
  assert.equal((await app.call('deletePartnerNote', { noteId: 'note' })).ok, true)
  assert.equal(app.tables.partner_notes.note, undefined)
  const archived = structuredClone(app.tables.trash.partner_note_note)
  const { _id, ...saved } = original
  assert.deepEqual(archived.doc, saved)
  assert.equal(Date.parse(archived.expiresAt) - Date.parse(archived.deletedAt), 30 * 86400000)
  assert.equal((await app.call('deletePartnerNote', { noteId: 'note' })).ok, true)
  assert.deepEqual(app.tables.trash.partner_note_note, archived)
})

// Model the pinned SDK's direct document payloads and atomic transactions.
// Transactions have no query support and cannot exceed 100 database operations.
function service(seed = {}, options = {}) {
  let tables = structuredClone({
    couples: { space: { _id: 'space', memberIds: ['user-a', 'user-b'] } },
    couple_members: {
      'space_user-a': { _id: 'space_user-a', coupleId: 'space', userId: 'user-a' },
      'space_user-b': { _id: 'space_user-b', coupleId: 'space', userId: 'user-b' },
    },
    ...seed,
  })
  let serial = Promise.resolve()
  let attempt = 0
  const commits = []
  const queryReads = []

  function collection(name, getTables, transaction) {
    const count = (method, id, payload) => {
      if (!transaction) return
      if (method === 'get') assert.equal(Boolean(transaction.wrote), false, 'read must precede transaction writes')
      else transaction.wrote = true
      transaction.operations++
      assert.ok(transaction.operations <= 100, 'SDK transaction operation limit exceeded')
      options.onOperation?.({ method, name, id, payload, attempt: transaction.attempt, tables: getTables() })
    }
    return {
      doc(id) {
        const docs = () => (getTables()[name] ||= {})
        return {
          async get() {
            count('get', id)
            const data = docs()[id] ? structuredClone(docs()[id]) : null
            return { data: transaction ? data : (data ? [data] : []) }
          },
          async set(payload) {
            count('set', id, payload)
            assert.equal(Object.hasOwn(payload, 'data'), false, 'SDK expects a direct payload')
            docs()[id] = { ...structuredClone(payload), _id: id }
            return { id }
          },
          async update(payload) {
            count('update', id, payload)
            if (options.zeroResult?.(name, id, 'update')) return { updated: 0 }
            if (!docs()[id]) return { updated: 0 }
            docs()[id] = { ...docs()[id], ...structuredClone(payload) }
            return { updated: 1 }
          },
          async remove() {
            count('remove', id)
            if (options.zeroResult?.(name, id, 'remove')) return { deleted: 0 }
            if (!docs()[id]) return { deleted: 0 }
            delete docs()[id]
            return { deleted: 1 }
          },
        }
      },
      where(filter) {
        assert.equal(Boolean(transaction), false, 'SDK transactions cannot query collections')
        let offset = 0
        let limit = 100
        const query = {
          skip(value) { offset = value; return query },
          limit(value) { limit = value; return query },
          async get() {
            queryReads.push({ name, filter, offset, limit })
            const matched = Object.values(getTables()[name] || {})
              .filter((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value))
            return { data: structuredClone(matched.slice(offset, offset + limit)) }
          },
        }
        return query
      },
    }
  }

  const db = {
    collection: (name) => collection(name, () => tables),
    runTransaction(callback) {
      const pending = serial.then(async () => {
        const snapshot = structuredClone(tables)
        const transaction = { attempt: ++attempt, operations: 0 }
        const result = await callback({ collection: (name) => collection(name, () => snapshot, transaction) })
        tables = snapshot
        commits.push(transaction.operations)
        return result
      })
      serial = pending.catch(() => {})
      return pending
    },
  }
  const exports = {}
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name !== '@cloudbase/node-sdk') return require(name)
      return { SYMBOL_CURRENT_ENV: 'test', init: () => ({
        database: () => db,
        auth: () => ({ getUserInfo: () => options.auth || { customUserId: 'user-a' } }),
      }) }
    },
    console: { warn() {}, error() {} },
  }, { filename: 'dataAccess/index.js' })
  return {
    async call(action, extra = {}) {
      const response = await exports.main({ action, coupleId: 'space', ...extra })
      return JSON.parse(JSON.stringify(response))
    },
    get tables() { return tables },
    commits,
    queryReads,
  }
}

test('migrates each nonempty legacy line without inventing time or deleting the original', async () => {
  const old = { _id: 'space', coupleId: 'space', likes: '  coffee  \r\ncoffee\n\n sea ', dislikes: '  loud  \rlate ', updatedAt: '2020-01-01' }
  const app = service({ couple_notes: { space: old } })
  const result = await app.call('listPartnerNotes')
  assert.equal(result.ok, true)
  assert.deepEqual(result.partnerNotes.map(({ text, kind }) => ({ text, kind })).sort((a, b) => a.text.localeCompare(b.text)), [
    { text: 'coffee', kind: 'like' }, { text: 'coffee', kind: 'like' },
    { text: 'late', kind: 'care' }, { text: 'loud', kind: 'care' }, { text: 'sea', kind: 'like' },
  ])
  assert.equal(new Set(result.partnerNotes.map((note) => note.id)).size, 5)
  assert.ok(result.partnerNotes.every((note) => note.createdAt === null && note.legacy === true && !('createdBy' in note)))
  assert.deepEqual(app.tables.couple_notes.space, old)
  assert.equal(app.tables.couples.space.partnerNotesMigrationVersion, 1)
  assert.equal(app.tables.couples.space.partnerNotesMigrationState, null)
})

test('concurrent and repeated reads migrate only once', async () => {
  const app = service({ couple_notes: { space: { coupleId: 'space', likes: 'one\ntwo', dislikes: 'three' } } })
  const results = await Promise.all(Array.from({ length: 6 }, () => app.call('listPartnerNotes')))
  for (const result of results) assert.deepEqual(result, results[0])
  assert.equal(Object.keys(app.tables.partner_notes).length, 3)
  assert.deepEqual(await app.call('listPartnerNotes'), results[0])
})

test('later reads preserve edits and do not resurrect deleted legacy entries', async () => {
  const app = service({ couple_notes: { space: { coupleId: 'space', likes: 'one\ntwo', dislikes: '' } } })
  const first = await app.call('listPartnerNotes')
  const one = first.partnerNotes.find((note) => note.text === 'one')
  const two = first.partnerNotes.find((note) => note.text === 'two')
  const edited = await app.call('updatePartnerNote', { noteId: one.id, note: {
    text: 'changed', kind: 'care', createdAt: '2099-01-01', createdBy: 'intruder', legacy: false, coupleId: 'other',
  } })
  assert.deepEqual(edited.partnerNote, { ...one, text: 'changed', kind: 'care' })
  assert.deepEqual(await app.call('deletePartnerNote', { noteId: two.id }), { ok: true })
  app.tables.couple_notes.space.likes = 'one\ntwo\nnew old-editor text'
  assert.deepEqual((await app.call('listPartnerNotes')).partnerNotes, [edited.partnerNote])
  assert.equal(app.tables.partner_notes[two.id], undefined)
})

test('migration batches stay under the SDK operation limit and resume after a failed batch', async () => {
  let failOnce = true
  const lines = Array.from({ length: 75 }, (_, index) => `line ${index}`).join('\n')
  const app = service({ couple_notes: { space: { coupleId: 'space', likes: lines, dislikes: '' } } }, {
    onOperation({ method, name, attempt }) {
      if (failOnce && attempt === 2 && method === 'set' && name === 'partner_notes') {
        failOnce = false
        throw new Error('temporary database failure')
      }
    },
  })
  const failed = await app.call('listPartnerNotes')
  assert.equal(failed.ok, false)
  assert.equal(Object.keys(app.tables.partner_notes).length, 30)
  assert.equal(app.tables.couples.space.partnerNotesMigrationState.cursor, 30)
  const committed = Object.values(app.tables.partner_notes)
  const deleted = committed[0]._id
  const changed = committed[1]._id
  delete app.tables.partner_notes[deleted]
  app.tables.partner_notes[changed].text = 'edited between batches'
  // A resumed migration must use its saved snapshot, including original line IDs.
  app.tables.couple_notes.space.likes = 'replacement old text'
  const resumed = await app.call('listPartnerNotes')
  assert.equal(resumed.ok, true)
  assert.equal(resumed.partnerNotes.length, 74)
  assert.equal(app.tables.partner_notes[deleted], undefined)
  assert.equal(app.tables.partner_notes[changed].text, 'edited between batches')
  assert.ok(resumed.partnerNotes.some((note) => note.text === 'line 74'))
  assert.ok(app.commits.every((operations) => operations <= 100))
  assert.equal(app.tables.couples.space.partnerNotesMigrationVersion, 1)
})

test('a transaction failure leaves no partial legacy entries or migration marker', async () => {
  let writes = 0
  const app = service({ couple_notes: { space: { coupleId: 'space', likes: 'one\ntwo' } } }, {
    onOperation({ method, name }) {
      if (method === 'set' && name === 'partner_notes' && ++writes === 2) throw new Error('write failed')
    },
  })
  assert.equal((await app.call('listPartnerNotes')).ok, false)
  assert.equal(app.tables.partner_notes, undefined)
  assert.equal(app.tables.couples.space.partnerNotesMigrationState, undefined)
  assert.equal(app.tables.couples.space.partnerNotesMigrationVersion, undefined)
  assert.equal((await app.call('listPartnerNotes')).partnerNotes.length, 2)
})

test('lists all pages only from the authorized couple, with newest entries first', async () => {
  const notes = Object.fromEntries(Array.from({ length: 105 }, (_, index) => {
    const id = `new_${index}`
    return [id, { _id: id, coupleId: 'space', text: `${index}`, kind: 'like', createdAt: new Date(2020, 0, index + 1).toISOString(), createdBy: 'user-b' }]
  }))
  notes.foreign = { _id: 'foreign', coupleId: 'other', text: 'secret', kind: 'care', createdAt: '2099-01-01T00:00:00.000Z' }
  notes.legacy = { _id: 'legacy', coupleId: 'space', text: 'old', kind: 'care', createdAt: null, legacy: true }
  const app = service({ partner_notes: notes })
  const result = await app.call('listPartnerNotes')
  assert.equal(result.partnerNotes.length, 106)
  assert.equal(result.partnerNotes[0].id, 'new_104')
  assert.equal(result.partnerNotes.at(-1).id, 'legacy')
  assert.ok(!result.partnerNotes.some((note) => note.id === 'foreign'))
  assert.deepEqual(app.queryReads.filter((query) => query.name === 'partner_notes').map(({ offset }) => offset), [0, 100])
})

test('creates with server publication time and author, ignoring client metadata', async () => {
  const app = service()
  const start = Date.now()
  const response = await app.call('createPartnerNote', { note: {
    text: '  coffee  ', kind: 'like', createdAt: '1999-01-01', createdBy: 'user-b', legacy: true, coupleId: 'other', _id: 'chosen',
  } })
  assert.equal(response.ok, true)
  const note = response.partnerNote
  assert.match(note.id, /^[a-f0-9-]{36}$/)
  assert.equal(note.text, 'coffee')
  assert.equal(note.kind, 'like')
  assert.equal(note.createdBy, 'user-a')
  assert.ok(!('legacy' in note))
  assert.ok(Date.parse(note.createdAt) >= start && Date.parse(note.createdAt) <= Date.now())
  assert.equal(app.tables.partner_notes[note.id].coupleId, 'space')
  assert.equal(app.tables.partner_notes.chosen, undefined)
})

test('updates only content and kind and returns the original server time and author', async () => {
  const app = service()
  const created = (await app.call('createPartnerNote', { note: { text: 'one', kind: 'like' } })).partnerNote
  const response = await app.call('updatePartnerNote', { noteId: created.id, note: {
    text: ' two ', kind: 'care', createdAt: '2099-01-01', createdBy: 'user-b', legacy: true, coupleId: 'other',
  } })
  assert.deepEqual(response.partnerNote, { ...created, text: 'two', kind: 'care' })
  assert.equal(app.tables.partner_notes[created.id].coupleId, 'space')
  assert.equal(app.tables.partner_notes[created.id].legacy, undefined)
})

test('rejects anonymous, nonmember, and noncanonical membership without migrating or writing', async () => {
  const anonymous = service({}, { auth: { isAnonymous: true, customUserId: 'user-a' } })
  assert.equal((await anonymous.call('listPartnerNotes')).code, 'UNAUTHENTICATED')
  const stranger = service({}, { auth: { customUserId: 'stranger' } })
  assert.equal((await stranger.call('createPartnerNote', { note: { text: 'one', kind: 'like' } })).code, 'FORBIDDEN')
  const forged = service({ couple_members: { forged: { _id: 'forged', coupleId: 'space', userId: 'user-a' } } })
  assert.equal((await forged.call('listPartnerNotes')).code, 'FORBIDDEN')
  assert.equal(forged.tables.partner_notes, undefined)
  assert.equal(forged.tables.couples.space.partnerNotesMigrationVersion, undefined)
})

test('rejects cross-couple targets and missing entries for both edit and delete', async () => {
  const app = service({ partner_notes: { foreign: { _id: 'foreign', coupleId: 'other', text: 'secret', kind: 'like', createdAt: null } } })
  for (const noteId of ['foreign', 'missing']) {
    const update = await app.call('updatePartnerNote', { noteId, note: { text: 'overwrite', kind: 'care' } })
    assert.equal(update.code, 'NOT_FOUND')
    assert.equal((await app.call('deletePartnerNote', { noteId })).code, 'NOT_FOUND')
  }
  assert.equal(app.tables.partner_notes.foreign.text, 'secret')
})

test('validates content type, length, kind, and note ID before creating or editing', async () => {
  const app = service()
  for (const note of [undefined, [], { text: 42, kind: 'like' }, { text: '  ', kind: 'like' },
    { text: 'x'.repeat(1001), kind: 'like' }, { text: 'one', kind: 'other' }]) {
    assert.equal((await app.call('createPartnerNote', { note })).code, 'INVALID_INPUT')
    assert.equal((await app.call('updatePartnerNote', { noteId: 'existing', note })).code, 'INVALID_INPUT')
  }
  assert.equal((await app.call('deletePartnerNote', { noteId: '../other' })).code, 'INVALID_INPUT')
  const created = await app.call('createPartnerNote', { note: { text: 'x'.repeat(1000), kind: 'care' } })
  assert.equal(created.ok, true)
  assert.equal(created.partnerNote.text.length, 1000)
})

test('fails rather than reporting successful edits or deletes when the SDK affects zero rows', async () => {
  const note = { _id: 'existing', coupleId: 'space', text: 'one', kind: 'like', createdAt: '2020-01-01T00:00:00.000Z', createdBy: 'user-b' }
  const app = service({ partner_notes: { existing: note } }, { zeroResult: (name) => name === 'partner_notes' })
  assert.equal((await app.call('updatePartnerNote', { noteId: 'existing', note: { text: 'two', kind: 'care' } })).code, 'NOT_FOUND')
  assert.equal((await app.call('deletePartnerNote', { noteId: 'existing' })).code, 'NOT_FOUND')
  assert.deepEqual(app.tables.partner_notes.existing, note)
})

test('a mismatched legacy parent or deterministic target cannot leak or overwrite another couple', async () => {
  const wrongParent = service({ couple_notes: { space: { coupleId: 'other', likes: 'secret' } } })
  assert.equal((await wrongParent.call('listPartnerNotes')).code, 'FORBIDDEN')
  assert.equal(wrongParent.tables.partner_notes, undefined)
  const { createHash } = require('node:crypto')
  const id = `legacy_${createHash('sha256').update(['space', 'like', '0'].join('\0')).digest('hex').slice(0, 40)}`
  const collision = service({
    couple_notes: { space: { coupleId: 'space', likes: 'one' } },
    partner_notes: { [id]: { _id: id, coupleId: 'other', text: 'secret', kind: 'care', createdAt: null } },
  })
  assert.equal((await collision.call('listPartnerNotes')).code, 'FORBIDDEN')
  assert.equal(collision.tables.partner_notes[id].text, 'secret')
})
