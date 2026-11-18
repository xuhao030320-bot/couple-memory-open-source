import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestBackupTarget } from './backup-target'

afterEach(() => vi.unstubAllGlobals())

function nativePicker() {
  const file = { write: vi.fn(async (_bytes: Uint8Array) => {}), close: vi.fn(async () => {}), abort: vi.fn(async (_reason?: unknown) => {}) }
  const picker = vi.fn(async () => ({ createWritable: async () => file }))
  vi.stubGlobal('window', { showSaveFilePicker: picker })
  return { file, picker }
}

describe('native backup transaction', () => {
  it('opens Save As during the click and commits the file only after the complete archive succeeds', async () => {
    const { file, picker } = nativePicker()
    const pending = requestBackupTarget('我们的备份.zip')
    expect(picker).toHaveBeenCalledOnce()
    const target = await pending
    const writer = target.writable!.getWriter()
    await writer.write(new Uint8Array([80, 75]))
    await writer.close()
    expect(file.write).toHaveBeenCalledOnce()
    expect(file.close).not.toHaveBeenCalled()
    await target.finish(null)
    expect(file.close).toHaveBeenCalledOnce()
    expect(file.abort).not.toHaveBeenCalled()
  })

  it('aborts an incomplete archive without committing the selected file', async () => {
    const { file } = nativePicker()
    const target = await requestBackupTarget('backup.zip')
    const writer = target.writable!.getWriter()
    await writer.write(new Uint8Array([80, 75]))
    await writer.close()
    const reason = new Error('第二份媒体下载失败')
    await target.abort(reason)
    expect(file.abort).toHaveBeenCalledWith(reason)
    expect(file.close).not.toHaveBeenCalled()
  })

  it('propagates cancellation before creating a writable file', async () => {
    const cancelled = new DOMException('Cancelled', 'AbortError')
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn().mockRejectedValue(cancelled) })
    await expect(requestBackupTarget('backup.zip')).rejects.toBe(cancelled)
  })
})
