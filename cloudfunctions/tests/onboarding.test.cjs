const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')

function createEnvironment() {
  const tables = new Map()
  let userId = ''
  const cloud = {
    auth: () => ({ getUserInfo: () => ({ customUserId: userId, isAnonymous: !userId }) }),
    database: () => db,
    async getUploadMetadata({ cloudPath, method }) {
      assert.equal(method, 'post')
      return { data: {
        url: 'https://example.invalid/upload', token: 'test', authorization: 'test',
        cosFileId: cloudPath, fileId: 'cloud://example.bucket/' + cloudPath,
      } }
    },
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map(({ fileID }) => ({ fileID, tempFileURL: 'https://example.invalid/photo' })) }
    },
  }
  function collection(name) {
    if (!tables.has(name)) tables.set(name, new Map())
    const docs = tables.get(name)
    return {
      async add(doc) {
        if (docs.has(doc._id)) throw new Error('duplicate document')
        docs.set(doc._id, { ...doc })
        return { id: doc._id }
      },
      doc(id) {
        return {
          async get() { return { data: docs.has(id) ? [docs.get(id)] : [] } },
          async set(doc) { docs.set(id, { ...doc, _id: id }) },
          async update(patch) {
            assert.ok(docs.has(id))
            Object.assign(docs.get(id), patch)
            return { updated: 1 }
          },
        }
      },
      where(filter) {
        const selected = [...docs.values()].filter(doc => Object.entries(filter).every(([key, value]) =>
          Array.isArray(value?.in) ? value.in.includes(doc[key]) : doc[key] === value))
        return {
          skip() { return this }, limit() { return this },
          async count() { return { total: selected.length } },
          async get() { return { data: selected } },
        }
      },
    }
  }
  const db = {
    collection, command: { in: values => ({ in: values }) },
    serverDate: () => new Date(), runTransaction: fn => fn({ collection }),
  }
  const sdk = {
    SYMBOL_CURRENT_ENV: Symbol('test'),
    init(options) {
      if (!options.credentials) return cloud
      assert.equal(options.env, 'test-env')
      return { auth: () => ({ createTicket: async uid => 'test-ticket/' + uid }) }
    },
  }
  function load(name) {
    const filename = path.join(__dirname, '..', name, 'index.js')
    const exports = {}
    const dependencies = createRequire(filename)
    const env = { TCB_CUSTOM_LOGIN_KEY: Buffer.from(JSON.stringify({ env_id: 'test-env' })).toString('base64') }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      exports, Buffer, console, process: { env },
      require: id => id === '@cloudbase/node-sdk' ? sdk : dependencies(id),
    }, { filename })
    return exports.main
  }
  return { load, signIn(id) { userId = id } }
}

test('email accounts can pair once, reopen the same workspace and keep it private', async () => {
  const env = createEnvironment()
  const auth = env.load('webAuth')
  const invite = env.load('invitePair')
  const join = env.load('joinCouple')
  const workspace = env.load('getMyWorkspace')
  const profile = env.load('updateMyProfile')
  const media = env.load('mediaAccess')
  const ai = env.load('aiAccess')
  const password = randomUUID()
  const accounts = []
  for (const name of ['first', 'second', 'third']) {
    const email = name + '@example.invalid'
    const created = await auth({ action: 'register', email, password, displayName: name })
    assert.equal(created.ok, true)
    assert.equal(typeof created.ticket, 'string')
    const duplicate = await auth({ action: 'register', email, password: randomUUID() })
    assert.equal(duplicate.code, 'USER_EXISTS')
    assert.equal((await auth({ action: 'login', email, password: randomUUID() })).code, 'INVALID_CREDENTIALS')
    const login = await auth({ action: 'login', email, password })
    assert.equal(login.ticket, created.ticket)
    accounts.push(login.ticket.slice('test-ticket/'.length))
  }
  assert.equal((await invite({})).ok, false)
  env.signIn(accounts[0])
  const created = await invite({ displayName: 'First', startDate: '2000-01-01' })
  assert.match(created.inviteCode, /^[A-Z2-9]{8}$/)
  env.signIn(accounts[1])
  assert.equal((await workspace()).couple, null)
  assert.equal((await join({ inviteCode: created.inviteCode, displayName: 'Second' })).ok, true)
  assert.equal((await workspace()).couple.memberCount, 2)
  assert.equal((await profile({ coupleId: created.coupleId, displayName: 'Renamed', startDate: '2001-01-01' })).ok, true)
  env.signIn(accounts[0])
  assert.equal((await workspace()).couple.startDate, '2001-01-01')
  const upload = await media({ action: 'prepareUpload', memoryId: 'entry', mediaId: 'photo', extension: 'jpg' })
  assert.equal(upload.upload.cloudPath, 'couple-photos/' + created.coupleId + '/entry/photo.jpg')
  const photos = await media({ action: 'getUrls', fileIDs: [upload.upload.fileID] })
  assert.equal(photos.files[0].fileID, upload.upload.fileID)
  const noAiKey = await ai({ action: 'chat', coupleId: created.coupleId, question: 'test' })
  assert.equal(noAiKey.code, 'NOT_CONFIGURED')
  env.signIn(accounts[2])
  assert.equal((await join({ inviteCode: created.inviteCode })).ok, false)
  assert.equal((await workspace()).couple, null)
  assert.equal((await profile({ coupleId: created.coupleId, displayName: 'Other', startDate: '2002-02-02' })).ok, false)
  assert.equal((await media({ action: 'getUrls', fileIDs: [] })).code, 'NO_WORKSPACE')
  assert.equal((await ai({ action: 'chat', coupleId: created.coupleId })).code, 'FORBIDDEN')
})
