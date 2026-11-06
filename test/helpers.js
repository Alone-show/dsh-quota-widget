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
 * 默认的 OpenCode status / activity 返回体。
 * @param {string} today 本地日期。
 * @returns {{ status: Record<string, any>, activity: Record<string, any> }} 两个响应。
 */
export function opencodeResponses(today) {
  return {
    status: {
      product: 'go',
      access: {
        startsAt: '2026-10-20T04:00:05.000Z',
        endsAt: '2026-11-20T04:00:05.000Z',
        meters: {
          fiveHour: {
            limitMicroCents: '1200000000',
            usedMicroCents: '232000000',
            startsAt: '2026-11-06T02:00:00.000Z',
            resetsAt: '2026-11-06T07:00:00.000Z',
          },
          week: {
            limitMicroCents: '3000000000',
            usedMicroCents: '827000000',
            resetsAt: '2026-11-13T00:00:00.000Z',
          },
          month: {
            limitMicroCents: '6000000000',
            usedMicroCents: '1150000000',
            resetsAt: '2026-11-20T04:00:05.000Z',
          },
        },
      },
      cancelAtPeriodEnd: false,
    },
    activity: {
      daily: [
        { date: today, totalTokens: 168885802, totalRequests: 1100, totalCostMicroCents: '293000000' },
      ],
    },
  }
}
