interface SaveHandle {
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> }>
}
interface SaveWindow {
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveHandle>
}
export interface BackupTarget {
  writable?: WritableStream<Uint8Array>
  finish: (blob: Blob | null) => Promise<void>
  abort: (reason?: unknown) => Promise<void>
}

/** Called in the click handler so desktop browsers retain the user gesture for Save As. */
export async function requestBackupTarget(filename: string): Promise<BackupTarget> {
  const picker = (window as unknown as SaveWindow).showSaveFilePicker
  if (picker) {
    const handle = await picker.call(window, { suggestedName: filename, types: [{ description: '空间备份 ZIP', accept: { 'application/zip': ['.zip'] } }] })
    const file = await handle.createWritable()
    // zip closes the wrapper, while the actual file commits only after every media entry succeeds.
    return {
      writable: new WritableStream<Uint8Array>({ write: (chunk) => file.write(chunk) }),
      finish: async () => { await file.close() },
      abort: async (reason) => { try { await file.abort(reason) } catch { /* Original file is retained on failed writes. */ } },
    }
  }
  return {
    finish: async (blob) => {
      if (!blob) throw new Error('备份文件未能生成，请重试')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    },
    abort: async () => undefined,
  }
}
