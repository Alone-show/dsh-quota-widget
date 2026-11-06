/**
 * 数据源读取过程中可向客户端暴露的稳定错误。
 *
 * 上游响应体、请求头、凭据值一律不放进 message；客户端只根据 code 做本地化，
 * message 仅在未知错误时作为兜底文本展示。
 */

/** 客户端已知的错误码。 */
export const ERROR_CODES = ['missing-credential', 'credential-rejected', 'upstream', 'config']

/** 带稳定 code 的额度读取错误。 */
export class QuotaError extends Error {
  /**
   * @param {'missing-credential' | 'credential-rejected' | 'upstream' | 'config'} code 稳定错误码。
   * @param {string} message 不含敏感信息的说明。
   * @param {{ ref?: string, httpStatus?: number }} [extra] 凭据引用名或上游 HTTP 状态。
   */
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'QuotaError'
    this.code = code
    if (extra.ref !== undefined) this.ref = extra.ref
    if (extra.httpStatus !== undefined) this.httpStatus = extra.httpStatus
  }
}

/**
 * 把任意异常收敛成响应里的 error 对象。
 * @param {unknown} error 适配器抛出的异常。
 * @returns {{ code: string, message: string, ref?: string }} 可下发的错误。
 */
export function toSourceError(error) {
  if (error instanceof QuotaError) {
    const payload = { code: error.code, message: error.message }
    if (error.ref !== undefined) payload.ref = error.ref
    return payload
  }
  return {
    code: 'upstream',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * 上游 HTTP 状态转稳定错误码。
 * @param {number} status HTTP 状态码。
 * @returns {'credential-rejected' | 'upstream'} 401/403 归为凭据被拒。
 */
export function codeForStatus(status) {
  return status === 401 || status === 403 ? 'credential-rejected' : 'upstream'
}

/**
 * 断言读取凭据成功，失败时抛出 missing-credential。
 * @param {string | undefined} value 已解析的凭据值。
 * @param {string} ref 凭据引用名。
 * @returns {string} 非空凭据。
 */
export function requireCredential(value, ref) {
  if (typeof value !== 'string' || value === '') {
    throw new QuotaError('missing-credential', `${ref} is not configured`, { ref })
  }
  return value
}
