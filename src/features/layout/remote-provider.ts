import type { LayoutProvider, LayoutInput, LayoutResult } from './types'

/**
 * Future model adapter. The app only depends on LayoutResult, so this endpoint
 * can later be backed by any cloud or local multimodal model.
 */
export class RemoteLayoutProvider implements LayoutProvider {
  readonly id = 'remote'
  readonly label = '模型排版'

  constructor(private readonly endpoint: string) {}

  async generate(input: LayoutInput): Promise<LayoutResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      throw new Error(`排版服务暂时不可用（${response.status}）`)
    }

    return response.json() as Promise<LayoutResult>
  }
}
