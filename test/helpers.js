/**
 * 测试用的适配器上下文与假响应。
 */

import { QuotaError } from '../lib/errors.js'

/**
 * 造一个适配器上下文。
 * @param {(url: string, headers: Record<string, string>) => Promise<any>} handler 请求处理函数。
 * @param {{ now?: Date, credential?: string | null, missing?: string }} [options] 选项。
 * @returns {Record<string, any>} 适配器上下文。
 */
export function adapterContext(handler, options = {}) {
  const now = options.now ?? new Date('2026-11-06T04:00:00Z')
  return {
    now,
    resolveCredential: async (ref) => {
      if (options.missing === ref) return undefined
      if (options.credential === null) return undefined
      return options.credential ?? `value-${ref}`
    },
    request: (url, headers) => handler(url, headers),
  }
}

/**
 * 造一个 HTTP 401 错误。
 * @returns {QuotaError} 凭据被拒错误。
 */
export function rejected() {
  return new QuotaError('credential-rejected', 'upstream responded HTTP 401', { httpStatus: 401 })
}

/**
 * 默认的 OpenCode 公开用量返回体。
 * @returns {{ usage: Record<string, any> }} 响应。
 */
export function opencodeUsage() {
  return {
    usage: {
      rolling: {
        status: 'ok',
        percent: 12,
        resetsAt: '2026-11-06T07:00:00.000Z',
      },
      weekly: {
        status: 'ok',
        percent: 34,
        resetsAt: '2026-11-13T00:00:00.000Z',
      },
      monthly: {
        status: 'ok',
        percent: 19.166666666666668,
        resetsAt: '2026-11-20T04:00:05.000Z',
      },
    },
  }
}
