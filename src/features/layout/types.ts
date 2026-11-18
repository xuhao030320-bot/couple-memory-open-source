import type {
  LayoutStyle,
  LayoutTemplate,
  MemoryCategory,
  PhotoAsset,
} from '../../types'

export interface LayoutInput {
  title?: string
  originalText: string
  date: string
  location?: string
  style: LayoutStyle
  photos: PhotoAsset[]
  category?: MemoryCategory
}

export interface LayoutResult {
  template: LayoutTemplate
  title: string
  polishedText: string
  palette: LayoutStyle
  photos: PhotoAsset[]
  tags: string[]
}

export interface LayoutProvider {
  readonly id: string
  readonly label: string
  generate(input: LayoutInput): Promise<LayoutResult>
}
