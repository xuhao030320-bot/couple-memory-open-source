import type { LayoutStyle, LayoutTemplate } from '../../types'
import type { LayoutInput, LayoutProvider, LayoutResult } from './types'

const styleTitles: Record<LayoutStyle, string[]> = {
  cream: ['寻常日子里的小事', '今天也值得收藏', '我们的小小日常'],
  film: ['这一格，留给今天', '暮色经过我们', '一卷未完的故事'],
  minimal: ['关于今天', '此刻，刚刚好', '留白里的我们'],
  ticket: ['下一站，是我们', '今日份出发', '把这天装进口袋'],
}

function chooseTemplate(photoCount: number, textLength: number, style: LayoutStyle): LayoutTemplate {
  if (photoCount >= 7) return 'grid-9'
  if (photoCount >= 5) return 'grid-6'
  if (photoCount === 4) return 'grid-4'
  if (style === 'film') return 'film-strip'
  if (style === 'minimal' || (photoCount <= 1 && textLength > 80)) return 'quiet-column'
  if (photoCount >= 3) return 'hero-grid'
  return 'hero-note'
}

function firstSentence(text: string) {
  const sentence = text.trim().split(/[。！？\n]/)[0]?.trim()
  if (!sentence || sentence.length < 3) return ''
  return sentence.length > 16 ? `${sentence.slice(0, 16)}…` : sentence
}

function inferTags(text: string, location?: string) {
  const tags: string[] = []
  const rules: Array<[RegExp, string]> = [
    [/旅行|出发|车站|酒店|海边|景点/, '旅行'],
    [/咖啡|餐厅|火锅|蛋糕|晚饭|午饭/, '好好吃饭'],
    [/生日|纪念日|周年|礼物/, '纪念日'],
    [/散步|公园|夕阳|晚风/, '散步'],
    [/电影|演出|音乐|展览/, '约会'],
  ]
  for (const [pattern, label] of rules) {
    if (pattern.test(text)) tags.push(label)
  }
  if (location?.trim()) tags.push('一起去过')
  return [...new Set(tags)].slice(0, 3)
}

export class RulesLayoutProvider implements LayoutProvider {
  readonly id = 'rules'
  readonly label = '规则排版'

  async generate(input: LayoutInput): Promise<LayoutResult> {
    const template = chooseTemplate(input.photos.length, input.originalText.length, input.style)
    const candidates = styleTitles[input.style]
    const title = input.title?.trim() || firstSentence(input.originalText) || candidates[input.photos.length % candidates.length]
    const photos = input.photos.map((photo, index) => ({
      ...photo,
      order: index,
      role: index === 0 ? ('cover' as const) : ('supporting' as const),
    }))

    return {
      template,
      title,
      polishedText: input.originalText.trim(),
      palette: input.style,
      photos,
      tags: inferTags(input.originalText, input.location),
    }
  }
}
