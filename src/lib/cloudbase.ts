import cloudbase from '@cloudbase/js-sdk'

/**
 * CloudBase Web SDK client 单例。
 * 只有配置了 VITE_CLOUDBASE_ENV_ID 才初始化，避免 supabase/local 模式下
 * 因空 env 初始化失败拖垮整个应用。
 */
const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim() || ''
const region = import.meta.env.VITE_CLOUDBASE_REGION?.trim() || 'ap-shanghai'
const accessKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim()
  || import.meta.env.VITE_CLOUDBASE_ACCESS_KEY?.trim() || ''

export const cloudbaseApp = envId && accessKey
  ? cloudbase.init({
      env: envId,
      region,
      persistence: 'local',
      // v3 SDK 要求调用方持有凭据（否则网关返回 credentials not found）
      accessKey,
    })
  : null

type CloudbaseApp = ReturnType<typeof cloudbase.init>

export function requireCloudbase(): CloudbaseApp {
  if (!cloudbaseApp) {
    throw new Error('CloudBase 需要环境 ID 和客户端 Publishable Key')
  }
  return cloudbaseApp
}

export function cloudbaseAuth() {
  return requireCloudbase().auth()
}

export function cloudbaseDb() {
  return requireCloudbase().database()
}

/** 从 SDK 的各种拒绝形态里提取可读信息。 */
function extractMessage(error: unknown): string {
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message
      ?? (error as { errMsg?: unknown }).errMsg
      ?? (error as { error?: unknown }).error
      ?? (error as { code?: unknown }).code
    if (candidate && typeof candidate !== 'object') return String(candidate)
    try {
      const dump = JSON.stringify(error, Object.getOwnPropertyNames(error))
      if (dump && dump !== '{}') return dump.slice(0, 300)
    } catch {
      // ignore
    }
  }
  return '未知错误'
}

/** 云函数返回值的各种形态归一：{result: 对象} / {result: JSON字符串} / 函数值直接在顶层。 */
function unwrapCallResult(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response
  const obj = response as Record<string, unknown>
  if ('result' in obj && obj.result !== undefined) {
    const result = obj.result
    if (typeof result === 'string') {
      try {
        return JSON.parse(result)
      } catch {
        return result
      }
    }
    return result
  }
  return response
}

/** 云函数调用统一入口（Web 端调用时云函数内 auth.getUserInfo() 可拿到调用者身份）。 */
export async function callCloudFunction<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  let response: unknown
  try {
    response = await requireCloudbase().callFunction({ name, data })
  } catch (error) {
    throw new Error(`云函数 ${name} 调用失败：${extractMessage(error)}`)
  }
  const result = unwrapCallResult(response)
  if (result === undefined || result === null) {
    let dump = '空响应'
    try {
      dump = JSON.stringify(response).slice(0, 200)
    } catch {
      // ignore
    }
    throw new Error(`云函数 ${name} 返回异常：${dump}`)
  }
  return result as T
}

interface MediaFunctionResponse {
  ok: boolean
  code?: string
  message?: string
}

interface PreparedUploadResponse extends MediaFunctionResponse {
  upload?: {
    url: string
    token: string
    authorization: string
    fileID: string
    cosFileId: string
    cloudPath: string
    successStatus?: number
  }
}

interface MediaUrlsResponse extends MediaFunctionResponse {
  files?: Array<{
    fileID: string
    url: string
    code?: string
    message?: string
  }>
}

function mediaError(response: MediaFunctionResponse, fallback: string) {
  return new Error(response.message || fallback)
}

/**
 * 先由 mediaAccess 根据登录身份生成当前情侣空间下的精确路径与一次性上传凭据，
 * 再把文件直传 COS。客户端从不提交或信任 coupleId。
 */
export async function uploadCloudFile(
  memoryId: string,
  mediaId: string,
  extension: string,
  file: Blob,
): Promise<string> {
  const response = await callCloudFunction<PreparedUploadResponse>('mediaAccess', {
    action: 'prepareUpload',
    memoryId,
    mediaId,
    extension,
  })
  if (!response.ok || !response.upload) throw mediaError(response, '上传凭据获取失败')

  const { upload } = response
  const form = new FormData()
  form.append('key', upload.cloudPath)
  form.append('signature', upload.authorization)
  form.append('x-cos-meta-fileid', upload.cosFileId)
  form.append('success_action_status', String(upload.successStatus || 201))
  form.append('x-cos-security-token', upload.token)
  const fileName = typeof File !== 'undefined' && file instanceof File
    ? file.name
    : `${mediaId}.${extension}`
  form.append('file', file, fileName)

  const uploadResponse = await fetch(upload.url, { method: 'POST', body: form })
  if (!uploadResponse.ok) {
    throw new Error(`照片或视频上传失败（${uploadResponse.status}）`)
  }
  return upload.fileID
}

/** 经 mediaAccess 校验当前情侣空间后，批量换取临时访问 URL。 */
export async function tempUrlsFor(fileIDs: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(fileIDs.filter(Boolean))]
  const urls = new Map<string, string>()
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50)
    const response = await callCloudFunction<MediaUrlsResponse>('mediaAccess', {
      action: 'getUrls',
      fileIDs: chunk,
    })
    if (!response.ok) throw mediaError(response, '照片临时链接获取失败')
    for (const item of response.files || []) {
      if (item.fileID && item.url) urls.set(item.fileID, item.url)
    }
  }
  return urls
}

/** 经 mediaAccess 校验后删除文件；失败只告警，孤儿文件比误删或遮盖原始业务错误安全。 */
export async function deleteCloudFiles(fileIDs: string[]): Promise<void> {
  const unique = [...new Set(fileIDs.filter(Boolean))]
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50)
    try {
      const response = await callCloudFunction<MediaFunctionResponse>('mediaAccess', {
        action: 'deleteFiles',
        fileIDs: chunk,
      })
      if (!response.ok) throw mediaError(response, '云存储文件删除失败')
    } catch (error) {
      console.warn('Could not remove cloud storage files', error)
    }
  }
}
