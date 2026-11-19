'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildMediaPath,
  isOwnedMediaFile,
  parseMediaFile,
  pathFromFileID,
  uniqueOwnedFileIDs,
} = require('../mediaAccess/policy')

const coupleId = 'cp_123_abc'
const path = 'couple-photos/cp_123_abc/550e8400-e29b-41d4-a716-446655440000/760e8400-e29b-41d4-a716-446655440001.jpg'
const fileID = `cloud://example.bucket/${path}`

test('buildMediaPath keeps the existing compatible directory layout', () => {
  assert.equal(
    buildMediaPath(
      coupleId,
      '550e8400-e29b-41d4-a716-446655440000',
      '760e8400-e29b-41d4-a716-446655440001',
      '.jpeg',
    ),
    path,
  )
})

test('fileID parsing accepts CloudBase file IDs and raw legacy paths', () => {
  assert.equal(pathFromFileID(fileID), path)
  assert.equal(pathFromFileID(path), path)
  assert.equal(parseMediaFile(fileID).coupleId, coupleId)
})

test('ownership check rejects other spaces, prefix tricks, URLs, and traversal', () => {
  assert.equal(isOwnedMediaFile(fileID, coupleId), true)
  assert.equal(isOwnedMediaFile(fileID, 'cp_other'), false)
  assert.equal(isOwnedMediaFile(fileID.replace(`${coupleId}/`, `${coupleId}-other/`), coupleId), false)
  assert.equal(isOwnedMediaFile(`https://example.test/${path}`, coupleId), false)
  assert.equal(isOwnedMediaFile(`cloud://example.bucket/couple-photos/${coupleId}/../secret.jpg`, coupleId), false)
})

test('upload path rejects traversal and unsupported extensions', () => {
  assert.throws(() => buildMediaPath(coupleId, '..', 'photo', 'jpg'))
  assert.throws(() => buildMediaPath(coupleId, 'memory', 'photo', 'exe'))
})

test('file lists are deduplicated and fail closed on a foreign file', () => {
  assert.deepEqual(uniqueOwnedFileIDs([fileID, fileID], coupleId), [fileID])
  assert.throws(() => uniqueOwnedFileIDs([fileID, fileID.replace(coupleId, 'cp_other')], coupleId))
})
