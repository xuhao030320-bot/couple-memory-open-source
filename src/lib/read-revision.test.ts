import { describe, expect, it } from 'vitest'
import { FreshReadGate } from './read-revision'

describe('messages returned out of order', () => {
  it('does not let an earlier focus poll replace a newer post-send result', () => {
    const gate = new FreshReadGate()
    const oldFocusPoll = gate.begin()
    gate.changed()
    const reconciliation = gate.begin()
    expect(gate.accepts(reconciliation)).toBe(true)
    expect(gate.accepts(oldFocusPoll)).toBe(false)
  })
  it('rejects an old workspace message field after a message was committed', () => {
    const gate = new FreshReadGate()
    const workspaceMessages = gate.begin()
    gate.changed()
    expect(gate.accepts(workspaceMessages)).toBe(false)
  })
  it('accepts a fresh read even when earlier requests finish later or fail', () => {
    const gate = new FreshReadGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.accepts(first)).toBe(false)
    expect(gate.accepts(second)).toBe(true)
  })
})
