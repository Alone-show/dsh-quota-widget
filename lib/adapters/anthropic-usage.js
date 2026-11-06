/**
 * Anthropic 用量 / 成本适配器。
 *
 * 使用 Admin API 的 usage_report/messages 与 cost_report。需要 Admin API Key
 * （sk-ant-admin01-…），普通 API Key 会 401/403。成本接口的 amount 以「分」为单位。
 */

import { QuotaError, requireCredential } from '../errors.js'
import {
  buildMeter,
  centsToUsd,
  localDateKey,
  localDateKeyFromIso,
  monthWindow,
  normalizeUsage,
} from '../quota.js'

export const id = 'anthropic-usage'
export const label = 'Anthropic'
export const labelKey = 'source.anthropic'
export const defaults = {
  baseUrl: 'https://api.anthropic.com',
  credential: 'ANTHROPIC_ADMIN_KEY',
  apiVersion: '2023-06-01',
}

/**
 * 累加成本桶；amount 是「分」的十进制字符串。
 * @param {Record<string, any>} body cost_report 返回体。
 * @param {string} today 本地日期。
 * @returns {{ totalUsd: number, todayUsd: number }} 当月与今日成本。
 */
function costTotals(body, today) {
  let totalCents = 0
  let todayCents = 0
  const buckets = Array.isArray(body?.data) ? body.data : []
  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : []
    const date = localDateKeyFromIso(bucket?.starting_at)
    for (const result of results) {
      const cents = Number(result?.amount)
      if (!Number.isFinite(cents)) continue
      totalCents += cents
      if (date === today) todayCents += cents
    }
  }
  return { totalUsd: centsToUsd(totalCents), todayUsd: centsToUsd(todayCents) }
}

/**
 * 累加 token 桶。
 * @param {Record<string, any>} body usage_report/messages 返回体。
 * @param {string} today 本地日期。
 * @returns {{ total: number, today: number }} 当月与今日 token。
 */
function tokenTotals(body, today) {
  let total = 0
  let todayTotal = 0
  const buckets = Array.isArray(body?.data) ? body.data : []
  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : []
    const date = localDateKeyFromIso(bucket?.starting_at)
    let bucketTotal = 0
    for (const result of results) {
      for (const field of [
        'uncached_input_tokens',
        'cache_read_input_tokens',
        'cache_creation_input_tokens',
        'output_tokens',
      ]) {
        const value = Number(result?.[field])
        if (Number.isFinite(value)) bucketTotal += value
      }
    }
    total += bucketTotal
    if (date === today) todayTotal += bucketTotal
  }
  return { total, today: todayTotal }
}

/**
 * 读取 Anthropic 用量 / 成本。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const ref = source.credential ?? defaults.credential
  const key = requireCredential(await ctx.resolveCredential(ref), ref)
  const baseUrl = String(source.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')
  const version = source.apiVersion ?? defaults.apiVersion
  const headers = { 'x-api-key': key, 'anthropic-version': version }
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const window = monthWindow(now)
  const today = localDateKey(now)

  const costUrl = `${baseUrl}/v1/organizations/cost_report?${new URLSearchParams({
    starting_at: window.startIso,
    ending_at: window.endIso,
    limit: '31',
  })}`
  const usageUrl = `${baseUrl}/v1/organizations/usage_report/messages?${new URLSearchParams({
    starting_at: window.startIso,
    ending_at: window.endIso,
    bucket_width: '1d',
    limit: '31',
  })}`

  const [costOutcome, usageOutcome] = await Promise.allSettled([
    ctx.request(costUrl, headers),
    ctx.request(usageUrl, headers),
  ])

  const costError = costOutcome.status === 'rejected' ? costOutcome.reason : undefined
  const usageError = usageOutcome.status === 'rejected' ? usageOutcome.reason : undefined
  for (const error of [costError, usageError]) {
    if (error instanceof QuotaError && error.code === 'credential-rejected') throw error
  }

  const costBody = costOutcome.status === 'fulfilled' ? costOutcome.value : undefined
  const usageBody = usageOutcome.status === 'fulfilled' ? usageOutcome.value : undefined
  if (costBody === undefined && usageBody === undefined) {
    throw costError instanceof QuotaError
      ? costError
      : new QuotaError('upstream', costError instanceof Error ? costError.message : 'anthropic api unavailable')
  }

  const meters = []
  if (costBody !== undefined) {
    const cost = costTotals(costBody, today)
    const budgetAmount = Number(source.budget?.amount)
    const meter = buildMeter({
      key: 'monthCost',
      labelKey: 'meter.monthCost',
      label: "This month's cost",
      used: cost.totalUsd,
      limit: Number.isFinite(budgetAmount) && budgetAmount > 0 ? budgetAmount : undefined,
      unit: 'usd',
      showValue: true,
      primary: true,
    })
    if (meter !== undefined) meters.push(meter)
  }

  let usage = null
  if (usageBody !== undefined) {
    const tokens = tokenTotals(usageBody, today)
    const cost = costBody !== undefined ? costTotals(costBody, today) : null
    usage = normalizeUsage({
      tokens: tokens.today,
      costUsd: cost?.todayUsd,
    })
  }

  return {
    ok: true,
    plan: null,
    meters,
    usage,
    notice: costBody === undefined || usageBody === undefined ? 'partial' : null,
    error: null,
  }
}
