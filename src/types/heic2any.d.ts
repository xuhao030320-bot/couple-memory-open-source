declare module 'heic2any' {
  interface Heic2AnyOptions {
    blob: Blob
    toType?: string
    quality?: number
    multiple?: boolean
  }

  /** 转换结果：单图时为 Blob，multiple 或含多图时为 Blob[]。 */
  export default function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>
}
