/**
 * 插件配置 schema 与语义校验。
 *
 * 类型、默认值、枚举由 schemastery 负责；跨字段约束（id 唯一、http 必须有 URL、
 * budget 只属于成本型数据源、pillSource 必须存在）在这里集中检查。
 */

import z from '@deepseek-ai/schemastery'
import { DRIVERS, DRIVER_IDS } from './adapters/index.js'

/** 凭据引用名：POSIX shell 标识符，配置里只存名字不存值。 */
const credentialRef = z
  .string()
  .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .role('credential-ref')
  .description('凭据服务里的引用名，例如 OPENCODE_GO_API_KEY')

const meterUnit = z.union(['usd', 'currency', 'percent', 'count', 'tokens', 'requests'])

/** HTTP 字段映射里的单个 meter 定义。 */
const meterDef = z.object({
  key: z.string().required(),
  label: z.string(),
  used: z.union([z.number(), z.string()]),
  limit: z.union([z.number(), z.string()]),
  value: z.union([z.number(), z.string()]),
  percent: z.union([z.number(), z.string()]),
  resetsAt: z.string(),
  startsAt: z.string(),
  unit: meterUnit.default('count'),
  currency: z.string(),
  currencyPath: z.string(),
  scale: z.number().default(1),
  showValue: z.boolean().default(true),
  primary: z.boolean().default(false),
})

/** 数组型 meter 的字段路径。 */
const fieldMap = z.object({
  key: z.string().default('key'),
  label: z.string(),
  used: z.string(),
  limit: z.string(),
  value: z.string(),
  percent: z.string(),
  resetsAt: z.string(),
  startsAt: z.string(),
  unit: z.string(),
  currency: z.string(),
  currencyPath: z.string(),
  scale: z.number().default(1),
})

/** 通用 HTTP 映射。 */
const mapping = z.object({
  meters: z.union([z.string(), z.array(meterDef)]),
  fields: fieldMap.default({}),
  plan: z.object({
    label: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    cancelAtPeriodEnd: z.string(),
  }).default({}),
  usage: z.object({
    label: z.string(),
    tokens: z.string(),
    requests: z.string(),
    costUsd: z.string(),
    date: z.string(),
  }).default({}),
}).default(undefined)

/** 通用 HTTP 认证。 */
const auth = z.object({
  type: z.union(['bearer', 'header', 'none']).default('bearer'),
  header: z.string().default('Authorization'),
  prefix: z.string().default('Bearer '),
}).default({})

/** 成本型数据源的月度预算。 */
const budget = z.object({
  amount: z.number().min(0).required(),
  currency: z.string().default('USD'),
}).default(undefined)

/** 一个数据源。 */
const source = z.object({
  id: z.string().pattern(/^[a-z0-9][a-z0-9-]*$/).required(),
  driver: z.union(DRIVER_IDS).default('opencode-go'),
  enabled: z.boolean().default(true),
  label: z.string(),
  credential: credentialRef,
  baseUrl: z.string(),
  apiVersion: z.string(),
  organization: z.string(),
  budget,
  url: z.string(),
  headers: z.dict(z.string()).default({}),
  query: z.dict(z.string()).default({}),
  auth,
  mapping,
  scale: z.number().default(1),
})

/** 默认只启用 OpenCode Go，保持安装即用的行为。 */
export const DEFAULT_SOURCE = {
  id: 'opencode-go',
  driver: 'opencode-go',
  enabled: true,
  credential: 'OPENCODE_GO_API_KEY',
}

/** 插件配置。 */
export const Config = z.object({
  sources: z.array(source).default([DEFAULT_SOURCE]),
  cache: z.object({
    ttlMs: z.number().min(1000).default(12000),
    errorTtlMs: z.number().min(500).default(5000),
    timeoutMs: z.number().min(500).default(8000),
  }).default({}),
  display: z.object({
    title: z.string(),
    pillSource: z.string(),
    pillMeter: z.string(),
    placement: z.union(['bottom-right', 'bottom-left']).default('bottom-right'),
    pollMs: z.number().min(5000).default(20000),
    showUsage: z.boolean().default(true),
  }).default({}),
})

/**
 * 校验配置；失败时抛错，让插件行显示明确的配置问题。
 * @param {Record<string, any>} config 已通过 schema 的配置。
 */
export function validateConfig(config) {
  const ids = new Set()
  for (const item of config.sources) {
    if (ids.has(item.id)) {
      throw new Error(`quota-widget: duplicate source id "${item.id}"`)
    }
    ids.add(item.id)
    if (!DRIVERS[item.driver]) {
      throw new Error(`quota-widget: unknown driver "${item.driver}" on source "${item.id}"`)
    }
    if (item.driver === 'http') {
      if (typeof item.url !== 'string' || item.url === '') {
        throw new Error(`quota-widget: source "${item.id}" (http) requires a url`)
      }
      let parsed
      try {
        parsed = new URL(item.url)
      } catch {
        throw new Error(`quota-widget: source "${item.id}" has an invalid url`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`quota-widget: source "${item.id}" url must use http or https`)
      }
      if (item.mapping !== undefined && item.mapping.meters === undefined) {
        throw new Error(`quota-widget: source "${item.id}" mapping requires meters`)
      }
      if (item.auth?.type === 'header' && (item.auth.header ?? '') === '') {
        throw new Error(`quota-widget: source "${item.id}" auth.header cannot be empty`)
      }
    }
    if (item.budget !== undefined) {
      if (item.driver !== 'anthropic-usage' && item.driver !== 'openai-usage') {
        throw new Error(`quota-widget: source "${item.id}" does not support budget`)
      }
      if (!(item.budget.amount > 0)) {
        throw new Error(`quota-widget: source "${item.id}" budget.amount must be greater than 0`)
      }
      if (String(item.budget.currency).toUpperCase() !== 'USD') {
        throw new Error(`quota-widget: source "${item.id}" budget currency must be USD`)
      }
    }
  }

  const pillSource = config.display.pillSource
  if (typeof pillSource === 'string' && pillSource !== '' && !ids.has(pillSource)) {
    throw new Error(`quota-widget: display.pillSource "${pillSource}" does not match any source id`)
  }
}

/**
 * 补齐 driver 默认值并过滤停用的数据源。
 * @param {Array<Record<string, any>>} sources 配置里的数据源。
 * @returns {Array<Record<string, any>>} 可直接交给适配器的数据源。
 */
export function normalizeSources(sources) {
  const normalized = []
  for (const item of sources) {
    if (item.enabled === false) continue
    const adapter = DRIVERS[item.driver]
    const label = typeof item.label === 'string' && item.label !== '' ? item.label : adapter.label
    normalized.push({
      ...item,
      label,
      labelKey: typeof item.label === 'string' && item.label !== '' ? undefined : adapter.labelKey,
      credential: item.credential ?? adapter.defaults.credential,
      baseUrl: item.baseUrl ?? adapter.defaults.baseUrl,
      apiVersion: item.apiVersion ?? adapter.defaults.apiVersion,
      headers: item.headers ?? {},
      query: item.query ?? {},
      auth: item.auth ?? { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
      scale: item.scale ?? 1,
    })
  }
  return normalized
}

/**
 * 生成下发给客户端的展示配置。
 * @param {Record<string, any>} display 配置里的 display。
 * @returns {Record<string, unknown>} 客户端展示参数。
 */
export function buildDisplay(display) {
  return {
    title: typeof display.title === 'string' && display.title !== '' ? display.title : null,
    pollMs: display.pollMs,
    pillSource: typeof display.pillSource === 'string' && display.pillSource !== '' ? display.pillSource : null,
    pillMeter: typeof display.pillMeter === 'string' && display.pillMeter !== '' ? display.pillMeter : null,
    placement: display.placement,
    showUsage: display.showUsage,
  }
}
