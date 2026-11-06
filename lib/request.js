/**
 * 宿主侧的上游 HTTP 读取。
 *
 * 只做 GET + JSON；错误只带 HTTP 状态和简短说明，不把上游响应体带进客户端。
 */

import { QuotaError, codeForStatus } from './errors.js'

/** 单个上游响应的最大字节数，避免异常接口撑爆宿主内存。 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/**
 * GET 一个 JSON 接口。
 * @param {string} url 目标地址。
 * @param {Record<string, string>} headers 请求头。
 * @param {number} timeoutMs 超时。
 * @returns {Promise<Record<string, any>>} 解析后的 JSON。
 */
export async function requestJson(url, headers, timeoutMs) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new QuotaError(codeForStatus(response.status), `upstream responded HTTP ${response.status}`, {
      httpStatus: response.status,
    })
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new QuotaError('upstream', 'upstream response is too large')
  }

  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new QuotaError('upstream', 'upstream response is too large')
  }

  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') {
      throw new QuotaError('upstream', 'upstream response is not a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof QuotaError) throw error
    throw new QuotaError('upstream', 'upstream response is not valid JSON')
  }
}

/**
 * 生成绑定超时的请求函数。
 * @param {number} timeoutMs 超时。
 * @returns {(url: string, headers: Record<string, string>) => Promise<Record<string, any>>} 请求函数。
 */
export function createRequester(timeoutMs) {
  return (url, headers) => requestJson(url, headers, timeoutMs)
}
