import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartnerNote, PartnerNoteInput } from '../../types'
import {
  createCloudPartnerNote,
  deleteCloudPartnerNote,
  loadCloudPartnerNotes,
  subscribeToCloudWorkspace,
  updateCloudPartnerNote,
  setCloudPartnerNotePinned,
} from './cloudbase'

const { callCloudFunction, cloudbaseDb } = vi.hoisted(() => ({
  callCloudFunction: vi.fn(),
  cloudbaseDb: vi.fn(),
}))

vi.mock('../cloudbase', () => ({
  callCloudFunction,
  cloudbaseDb,
  cloudbaseAuth: vi.fn(),
  deleteCloudFiles: vi.fn(),
  tempUrlsFor: vi.fn(),
  uploadCloudFile: vi.fn(),
}))

const canonical: PartnerNote = {
  id: 'server-note', text: 'coffee', kind: 'like',
  createdAt: '2026-10-02T08:10:00.000Z', createdBy: 'authenticated-user',
}

beforeEach(() => {
  callCloudFunction.mockReset()
  cloudbaseDb.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CloudBase independent partner notes', () => {
  it('sets only pinned and retains server publication time and author', async () => {
    callCloudFunction.mockResolvedValue({ ok: true, partnerNote: { ...canonical, pinned: true } })
    await expect(setCloudPartnerNotePinned('space', canonical.id, true)).resolves.toEqual({ ...canonical, pinned: true })
    expect(callCloudFunction).toHaveBeenCalledWith('dataAccess', { action: 'setPartnerNotePinned', coupleId: 'space', noteId: canonical.id, pinned: true })
  })
  it('loads server records and retains unknown publication dates for legacy notes', async () => {
    const legacy: PartnerNote = { id: 'legacy-note', text: 'quiet', kind: 'care', createdAt: null, legacy: true }
    callCloudFunction.mockResolvedValue({ ok: true, partnerNotes: [canonical, legacy] })
    await expect(loadCloudPartnerNotes('space')).resolves.toEqual([canonical, legacy])
    expect(callCloudFunction).toHaveBeenCalledWith('dataAccess', { action: 'listPartnerNotes', coupleId: 'space' })
  })

  it('creates using only editable fields and returns canonical server time, author and ID', async () => {
    callCloudFunction.mockResolvedValue({ ok: true, partnerNote: canonical })
    const forged = { text: ' coffee ', kind: 'like', id: 'chosen', createdAt: '1999-01-01', createdBy: 'other' } as PartnerNoteInput
    await expect(createCloudPartnerNote('space', forged)).resolves.toEqual(canonical)
    expect(callCloudFunction).toHaveBeenCalledWith('dataAccess', {
      action: 'createPartnerNote', coupleId: 'space', note: { text: 'coffee', kind: 'like' },
    })
  })

  it('updates a named entry and returns the server record without inventing a new publication date', async () => {
    const updated = { ...canonical, text: 'quiet', kind: 'care' }
    callCloudFunction.mockResolvedValue({ ok: true, partnerNote: updated })
    await expect(updateCloudPartnerNote('space', canonical.id, { text: ' quiet ', kind: 'care' })).resolves.toEqual(updated)
    expect(callCloudFunction).toHaveBeenCalledWith('dataAccess', {
      action: 'updatePartnerNote', coupleId: 'space', noteId: canonical.id, note: { text: 'quiet', kind: 'care' },
    })
  })

  it('deletes only the requested ID in the current couple', async () => {
    callCloudFunction.mockResolvedValue({ ok: true })
    await expect(deleteCloudPartnerNote('space', canonical.id)).resolves.toBeUndefined()
    expect(callCloudFunction).toHaveBeenCalledWith('dataAccess', {
      action: 'deletePartnerNote', coupleId: 'space', noteId: canonical.id,
    })
  })

  it('propagates read and mutation errors instead of reporting an empty list or a successful save', async () => {
    callCloudFunction.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'membership rejected' })
    await expect(loadCloudPartnerNotes('space')).rejects.toThrow('membership rejected')
    await expect(createCloudPartnerNote('space', { text: 'one', kind: 'like' })).rejects.toThrow('membership rejected')
    await expect(updateCloudPartnerNote('space', 'note', { text: 'one', kind: 'like' })).rejects.toThrow('membership rejected')
    await expect(deleteCloudPartnerNote('space', 'note')).rejects.toThrow('membership rejected')
    callCloudFunction.mockRejectedValue(new Error('connection failed'))
    await expect(createCloudPartnerNote('space', { text: 'one', kind: 'like' })).rejects.toThrow('connection failed')
  })

  it('rejects missing or malformed canonical records', async () => {
    for (const partnerNote of [undefined, { ...canonical, id: '' }, { ...canonical, kind: 'other' },
      { ...canonical, createdAt: undefined }, { ...canonical, createdAt: 'invalid-date' }]) {
      callCloudFunction.mockResolvedValue({ ok: true, partnerNote })
      await expect(createCloudPartnerNote('space', { text: 'one', kind: 'like' })).rejects.toThrow('备忘服务返回异常')
    }
    callCloudFunction.mockResolvedValue({ ok: true })
    await expect(loadCloudPartnerNotes('space')).rejects.toThrow('备忘服务返回异常')
    callCloudFunction.mockResolvedValue({ ok: true, partnerNotes: [{ ...canonical, text: 42 }] })
    await expect(loadCloudPartnerNotes('space')).rejects.toThrow('备忘服务返回异常')
  })

  it('watches the independent collection within the current couple and releases its watcher', () => {
    const registrations: Array<{ name: string; filter: unknown; onChange: () => void; onError: (error: unknown) => void; close: ReturnType<typeof vi.fn> }> = []
    cloudbaseDb.mockReturnValue({ collection(name: string) {
      const query = (filter: unknown) => ({ watch({ onChange, onError }: { onChange: () => void; onError: (error: unknown) => void }) {
        const close = vi.fn()
        registrations.push({ name, filter, onChange, onError, close })
        return { close }
      } })
      return { doc: query, where: query }
    } })
    const onChange = vi.fn()
    const handle = subscribeToCloudWorkspace('space', onChange)
    const notes = registrations.find((registration) => registration.name === 'partner_notes')!
    expect(notes.filter).toEqual({ coupleId: 'space' })
    notes.onChange()
    expect(onChange).toHaveBeenCalledOnce()
    handle.close()
    handle.close()
    expect(notes.close).toHaveBeenCalledOnce()
    notes.onChange()
    notes.onError(new Error('late disconnect'))
    expect(onChange).toHaveBeenCalledOnce()
  })
})
