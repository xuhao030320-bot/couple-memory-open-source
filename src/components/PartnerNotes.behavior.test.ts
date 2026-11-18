import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartnerNote } from '../types'
import { PartnerNotes } from './PartnerNotes'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }))

// Execute the real component's hooks and handlers without a browser or DOM package.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [hooks.slots[index], (next: T | ((previous: T) => T)) => {
        hooks.slots[index] = typeof next === 'function' ? (next as (previous: T) => T)(hooks.slots[index] as T) : next
      }]
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }
      return hooks.slots[index]
    },
    useId() { hooks.cursor++; return 'notes-behavior' },
    useMemo<T>(create: () => T) { hooks.cursor++; return create() },
    useEffect(effect: () => void, deps: unknown[]) {
      const index = hooks.cursor++
      const previous = hooks.slots[index] as unknown[] | undefined
      if (!previous || deps.some((item, offset) => !Object.is(item, previous[offset]))) hooks.effects.push(effect)
      hooks.slots[index] = deps
    },
  }
})

type Node = { type: unknown; props: Record<string, any> }
function allNodes(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(allNodes)
  if (!isValidElement<Record<string, any>>(node)) return []
  return [node, ...allNodes(node.props.children)]
}

function label(node: unknown): string {
  if (Array.isArray(node)) return node.map(label).join('')
  if (isValidElement<Record<string, unknown>>(node)) return label(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

const note: PartnerNote = { id: 'note', text: 'coffee', kind: 'like', createdAt: '2026-10-19T08:10:00.000Z', createdBy: 'partner' }
const focus = vi.fn()
const scrollIntoView = vi.fn()
let values: Map<string, string>

function fixture(notes: PartnerNote[] = [note]) {
  return {
    notes, scope: 'cloudbase:qa-space:qa-user', myUserId: 'qa-user',
    onCreate: vi.fn(async () => {}), onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}), onTogglePin: vi.fn(async (_id: string, _pinned: boolean) => {}),
  }
}

function render(props: ReturnType<typeof fixture>) {
  hooks.cursor = 0
  hooks.effects = []
  const outer = PartnerNotes(props)
  const component = outer.type as (props: typeof outer.props) => ReactNode
  const nodes = allNodes(component(outer.props))
  const textarea = nodes.find((node) => node.type === 'textarea')!
  textarea.props.ref.current = { focus, scrollIntoView }
  for (const effect of hooks.effects) effect()
  return {
    nodes,
    textarea,
    button(text: string) { return nodes.find((node) => node.type === 'button' && label(node.props.children) === text)! },
    shell: nodes.find((node) => node.props.className === 'partner-notes-compose-shell')!,
    articles: nodes.filter((node) => node.type === 'article'),
  }
}

beforeEach(() => {
  hooks.slots = []
  hooks.cursor = 0
  hooks.effects = []
  values = new Map()
  focus.mockClear()
  scrollIntoView.mockClear()
  vi.stubGlobal('window', {
    confirm: vi.fn(() => true), matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
  })
})

describe('partner note browsing interactions', () => {
  it('loads more, searches and filters, then clears filters without altering official notes', () => {
    const props = fixture(Array.from({ length: 25 }, (_, index) => ({ ...note, id: `${index}`, text: index === 5 ? 'target coffee' : `other ${index}`, kind: index === 5 ? 'like' : 'care' })))
    const original = JSON.stringify(props.notes)
    let page = render(props)
    expect(page.articles).toHaveLength(20)
    page.button('再看 5 条 · 还有 5 条').props.onClick()
    page = render(props)
    expect(page.articles).toHaveLength(25)
    page.nodes.find((node) => node.props['aria-label'] === '搜索备忘')!.props.onChange({ target: { value: ' target ' } })
    page = render(props)
    expect(page.articles).toHaveLength(1)
    page.nodes.find((node) => node.props['aria-label'] === '筛选备忘类别')!.props.children.find((node: Node) => label(node.props.children) === '需要留意').props.onClick()
    page = render(props)
    expect(page.articles).toHaveLength(0)
    page.button('清除筛选').props.onClick()
    page = render(props)
    expect(page.articles).toHaveLength(20)
    expect(JSON.stringify(props.notes)).toBe(original)
    expect(values.size).toBe(0)
  })

  it('keeps a draft when collapsed and opens the selected edit with focus and scrolling', () => {
    const props = fixture()
    let page = render(props)
    expect(page.shell.props.hidden).toBe(true)
    page.button('写一条备忘').props.onClick()
    page = render(props)
    expect(page.shell.props.hidden).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
    page.textarea.props.onChange({ target: { value: 'unsaved draft' } })
    page = render(props)
    expect([...values.values()][0]).toContain('unsaved draft')
    page.button('收起编辑').props.onClick()
    page = render(props)
    expect(page.shell.props.hidden).toBe(true)
    expect(page.textarea.props.value).toBe('unsaved draft')
    page.button('编辑').props.onClick()
    page = render(props)
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(page.shell.props.hidden).toBe(false)
    expect(page.textarea.props.value).toBe('coffee')
    expect(focus).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('pins through its own callback without rewriting the note and reports failures', async () => {
    const props = fixture()
    let reject!: (error: Error) => void
    props.onTogglePin.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise }))
    let page = render(props)
    page.button('置顶').props.onClick()
    page = render(props)
    expect(props.onTogglePin).toHaveBeenCalledWith('note', true)
    expect(page.button('置顶').props.disabled).toBe(true)
    reject(new Error('pin failed'))
    await Promise.resolve()
    await Promise.resolve()
    page = render(props)
    expect(page.nodes.some((node) => node.props.role === 'alert' && label(node.props.children) === 'pin failed')).toBe(true)
    expect(page.button('置顶').props.disabled).toBe(false)
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(props.onUpdate).not.toHaveBeenCalled()
    expect(props.notes[0]).toEqual(note)
  })

  it('keeps a failed publication and its draft available for retry, then collapses after success', async () => {
    const props = fixture()
    props.onCreate.mockRejectedValueOnce(new Error('offline'))
    let page = render(props)
    page.button('写一条备忘').props.onClick()
    page = render(props)
    page.textarea.props.onChange({ target: { value: 'new draft' } })
    page = render(props)
    await page.nodes.find((node) => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
    page = render(props)
    expect(page.shell.props.hidden).toBe(false)
    expect(page.textarea.props.value).toBe('new draft')
    expect([...values.values()][0]).toContain('new draft')
    expect(page.button('重试发布')).toBeDefined()
    await page.nodes.find((node) => node.type === 'form')!.props.onSubmit({ preventDefault() {} })
    page = render(props)
    expect(page.shell.props.hidden).toBe(true)
    expect(page.textarea.props.value).toBe('')
    expect(values.size).toBe(0)
  })
})
