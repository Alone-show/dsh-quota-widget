/**
 * OpenAI 用量 / 成本适配器。
 *
 * 使用 Admin API 的 /organization/costs 与 /organization/usage/completions。
 * 需要 Admin API Key（sk-admin-…），普通 API Key 会 401/403。
 */

import { QuotaError, requireCredential } from '../errors.js'
import {
  buildMeter,
  localDateKey,
  localDateKeyFromUnix,
  monthWindow,
  normalizeUsage,
} from '../quota.js'

export const id = 'openai-usage'
export const label = 'OpenAI'
export const labelKey = 'source.openai'
export const defaults = {
  baseUrl: 'https://api.openai.com/v1',
  credential: 'OPENAI_ADMIN_KEY',
}

/**
 * 遍历成本桶，兼容 data[].results[] 与平铺 results[] 两种响应。
 * @param {Record<string, any>} body 响应体。
 * @param {string} today 本地日期。
 * @returns {{ totalUsd: number, todayUsd: number }} 当月与今日成本。
 */
function costTotals(body, today) {
  let totalUsd = 0
  let todayUsd = 0
  const buckets = Array.isArray(body?.data) ? body.data : undefined
  if (buckets !== undefined) {
    for (const bucket of buckets) {
      const date = localDateKeyFromUnix(bucket?.start_time)
      const results = Array.isArray(bucket?.results) ? bucket.results : []
      for (const result of results) {
        const value = Number(result?.amount?.value)
        if (!Number.isFinite(value)) continue
        totalUsd += value
        if (date === today) todayUsd += value
      }
    }
    return { totalUsd, todayUsd }
  }
  const results = Array.isArray(body?.results) ? body.results : []
  for (const result of results) {
    const value = Number(result?.amount?.value)
    if (!Number.isFinite(value)) continue
    totalUsd += value
    todayUsd += value
  }
  return { totalUsd, todayUsd }
}

/**
 * 遍历用量桶，兼容两种响应形态。
 * @param {Record<string, any>} body 响应体。
 * @param {string} today 本地日期。
 * @returns {{ tokens: number, requests: number }} 今日 token 与请求数。
 */
function usageTotals(body, today) {
  let tokens = 0
  let requests = 0
  const buckets = Array.isArray(body?.data) ? body.data : undefined
  if (buckets !== undefined) {
    for (const bucket of buckets) {
      if (localDateKeyFromUnix(bucket?.start_time) !== today) continue
      const results = Array.isArray(bucket?.results) ? bucket.results : []
      for (const result of results) {
        const input = Number(result?.input_tokens)
        const output = Number(result?.output_tokens)
        const calls = Number(result?.num_model_requests)
        if (Number.isFinite(input)) tokens += input
        if (Number.isFinite(output)) tokens += output
        if (Number.isFinite(calls)) requests += calls
      }
    }
    return { tokens, requests }
  }
  const results = Array.isArray(body?.results) ? body.results : []
  for (const result of results) {
    const input = Number(result?.input_tokens)
    const output = Number(result?.output_tokens)
    const calls = Number(result?.num_model_requests)
    if (Number.isFinite(input)) tokens += input
    if (Number.isFinite(output)) tokens += output
    if (Number.isFinite(calls)) requests += calls
  }
  return { tokens, requests }
}

/**
 * 读取 OpenAI 用量 / 成本。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const ref = source.credential ?? defaults.credential
  const key = requireCredential(await ctx.resolveCredential(ref), ref)
  const baseUrl = String(source.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${key}` }
  if (typeof source.organization === 'string' && source.organization !== '') {
    headers['openai-organization'] = source.organization
  }
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const window = monthWindow(now)
  const today = localDateKey(now)
  const query = new URLSearchParams({
    start_time: String(window.startUnix),
    end_time: String(window.endUnix),
    bucket_width: '1d',
    limit: '31',
  })

  const [costOutcome, usageOutcome] = await Promise.allSettled([
    ctx.request(`${baseUrl}/organization/costs?${query}`, headers),
    ctx.request(`${baseUrl}/organization/usage/completions?${query}`, headers),
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
      : new QuotaError('upstream', costError instanceof Error ? costError.message : 'openai api unavailable')
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
    const totals = usageTotals(usageBody, today)
    const cost = costBody !== undefined ? costTotals(costBody, today) : null
    usage = normalizeUsage({
      tokens: totals.tokens,
      requests: totals.requests,
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
