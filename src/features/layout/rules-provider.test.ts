import { describe, expect, it } from 'vitest'
import { RulesLayoutProvider } from './rules-provider'

describe('RulesLayoutProvider', () => {
  it('uses a grid when several photos are provided', async () => {
    const provider = new RulesLayoutProvider()
    const result = await provider.generate({
      originalText: '今天一起去公园散步，看到了很漂亮的夕阳。',
      date: '2026-08-02',
      location: '江边公园',
      style: 'cream',
      photos: Array.from({ length: 4 }, (_, index) => ({
        id: String(index),
        src: '',
        name: '',
        alt: '',
        caption: '',
        order: index,
        role: index === 0 ? 'cover' : 'supporting',
        focusX: 0.5,
        focusY: 0.5,
        kind: 'image',
        mimeType: 'image/jpeg',
      })),
    })

    expect(result.template).toBe('grid-4')
    expect(result.tags).toContain('散步')
    expect(result.photos[0].role).toBe('cover')
  })
})
