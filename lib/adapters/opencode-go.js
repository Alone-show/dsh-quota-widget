/**
 * OpenCode Go 适配器：沿用原插件的 /go/status + /activity/go 逻辑。
 */

import { QuotaError, requireCredential } from '../errors.js'
import { buildMeter, localDateKey, microCentsToUsd, normalizePlan, normalizeUsage } from '../quota.js'

export const id = 'opencode-go'
export const label = 'OpenCode Go'
export const labelKey = 'source.opencode-go'
export const defaults = {
  baseUrl: 'https://opencode.ai/console/api',
  credential: 'OPENCODE_GO_API_KEY',
}

const METER_KEYS = ['fiveHour', 'week', 'month']

/**
 * 套餐信息只保留展示字段，账号标识不下发。
 * @param {Record<string, any> | undefined} status /go/status 的返回体。
 * @returns {{ plan: Record<string, unknown> | null, isGo: boolean }} 套餐视图。
 */
function planOf(status) {
  if (status === undefined) return { plan: null, isGo: false }
  const product = typeof status.product === 'string' ? status.product : ''
  const access = status.access && typeof status.access === 'object' ? status.access : {}
  const meters = access.meters && typeof access.meters === 'object' ? access.meters : undefined
  return {
    plan: normalizePlan({
      label: product === 'go-plus' ? 'Go Plus' : product === 'go' ? 'Go' : 'OpenCode',
      startsAt: access.startsAt,
      endsAt: access.endsAt,
      cancelAtPeriodEnd: status.cancelAtPeriodEnd === true,
    }),
    isGo: (product === 'go' || product === 'go-plus') && meters !== undefined,
  }
}

/**
 * 把一个计量窗口压成 meter。
 * @param {string} key fiveHour | week | month。
 * @param {Record<string, any> | undefined} meter 接口里的窗口。
 * @returns {Record<string, unknown> | undefined} 归一化 meter。
 */
function meterOf(key, meter) {
  const limit = microCentsToUsd(meter?.limitMicroCents)
  const used = microCentsToUsd(meter?.usedMicroCents)
  return buildMeter({
    key,
    labelKey: `meter.${key}`,
    used,
    limit,
    percent: limit > 0 ? undefined : 0,
    unit: 'usd',
    showValue: false,
    startsAt: meter?.startsAt,
    resetsAt: meter?.resetsAt,
    primary: key === 'month',
  })
}

/**
 * 今日用量：取 daily 里日期等于今天的一条。
 * @param {Record<string, any> | undefined} activity /activity/go 的返回体。
 * @returns {Record<string, unknown> | null} 今日用量。
 */
function todayOf(activity) {
  const daily = Array.isArray(activity?.daily) ? activity.daily : []
  const today = localDateKey()
  const row = daily.find((entry) => entry?.date === today)
  if (row === undefined) return null
  return normalizeUsage({
    date: row.date,
    tokens: row.totalTokens,
    requests: row.totalRequests,
    costUsd: microCentsToUsd(row.totalCostMicroCents),
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
  const headers = { authorization: `Bearer ${key}` }

  const [statusOutcome, activityOutcome] = await Promise.allSettled([
    ctx.request(`${baseUrl}/go/status`, headers),
    ctx.request(`${baseUrl}/activity/go`, headers),
  ])

  const statusError = statusOutcome.status === 'rejected' ? statusOutcome.reason : undefined
  if (statusError instanceof QuotaError && statusError.code === 'credential-rejected') {
    throw statusError
  }

  const status = statusOutcome.status === 'fulfilled' ? statusOutcome.value : undefined
  const activity = activityOutcome.status === 'fulfilled' ? activityOutcome.value : undefined
  if (status === undefined && activity === undefined) {
    throw statusError instanceof QuotaError
      ? statusError
      : new QuotaError('upstream', statusError instanceof Error ? statusError.message : 'opencode api unavailable')
  }

  const { plan, isGo } = planOf(status)
  return {
    ok: true,
    plan,
    meters: isGo
      ? METER_KEYS.map((meterKey) => meterOf(meterKey, status?.access?.meters?.[meterKey])).filter(Boolean)
      : [],
    usage: todayOf(activity),
    notice: isGo ? null : status === undefined ? 'unknown' : 'non-go',
    error: null,
  }
}
