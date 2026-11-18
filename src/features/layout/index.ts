import { RemoteLayoutProvider } from './remote-provider'
import { RulesLayoutProvider } from './rules-provider'
import type { LayoutProvider } from './types'

export type { LayoutInput, LayoutProvider, LayoutResult } from './types'

export function createLayoutProvider(): LayoutProvider {
  if (import.meta.env.VITE_LAYOUT_PROVIDER === 'remote') {
    return new RemoteLayoutProvider(import.meta.env.VITE_LAYOUT_ENDPOINT || '/api/layout/generate')
  }
  return new RulesLayoutProvider()
}
