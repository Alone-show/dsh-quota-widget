/**
 * OpenCode Go 适配器：读取公开用量接口 `GET {baseUrl}/usage`。
 *
 * 旧实现走 `console/api/go/status` + `/activity/go`，那是 Console 网页会话接口，
 * 需要 `__Host-console_session` cookie；只带 `Authorization: Bearer` 的 `oc_sk_` key
 * 会被 403，插件再把它误报成「API Key 被拒绝」。公开用量接口只认 Bearer key，
 * 返回 5 小时 / 本周 / 本月三个窗口的百分比。
 *
 * 公开用量接口没有按天的 tokens / 请求数 / 成本，也没有套餐名，所以这里的
 * `usage` 与 `plan` 都为 null。
 */

import { QuotaError, requireCredential } from '../errors.js'
import { buildMeter } from '../quota.js'

export const id = 'opencode-go'
export const label = 'OpenCode Go'
export const labelKey = 'source.opencode-go'
export const defaults = {
  baseUrl: 'https://opencode.ai/inference/go/v1',
  credential: 'OPENCODE_GO_API_KEY',
}

/** 接口里的窗口名 → 界面 meter key。 */
const WINDOWS = [
  { key: 'fiveHour', field: 'rolling' },
  { key: 'week', field: 'weekly' },
  { key: 'month', field: 'monthly' },
]

/**
 * 把一个窗口压成 meter。
 * @param {string} key fiveHour | week | month。
 * @param {Record<string, any> | undefined} window 接口里的窗口。
 * @returns {Record<string, unknown> | undefined} 归一化 meter。
 */
function meterOf(key, window) {
  if (window === null || typeof window !== 'object') return undefined
  return buildMeter({
    key,
    labelKey: `meter.${key}`,
    percent: window.percent,
    unit: 'percent',
    showValue: false,
    resetsAt: typeof window.resetsAt === 'string' ? window.resetsAt : undefined,
    primary: key === 'month',
  })
}

/**
 * 读取 OpenCode Go。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const ref = source.credential ?? defaults.credential
  const key = requireCredential(await ctx.resolveCredential(ref), ref)
  const baseUrl = String(source.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')
  const body = await ctx.request(`${baseUrl}/usage`, { authorization: `Bearer ${key}` })

  const usage = body !== null && typeof body === 'object' && body.usage !== null && typeof body.usage === 'object'
    ? body.usage
    : undefined
  if (usage === undefined) {
    throw new QuotaError('upstream', 'opencode usage response has no usage object')
  }

  const meters = WINDOWS
    .map((entry) => meterOf(entry.key, usage[entry.field]))
    .filter(Boolean)

  return {
    ok: true,
    plan: null,
    meters,
    usage: null,
    notice: meters.length === 0 ? 'unknown' : meters.length < WINDOWS.length ? 'partial' : null,
    error: null,
  }
}
