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

/**
 * 插件配置。
 *
 * 三个顶层组都是 volatile：浏览器侧「插件」页的配置表单只允许写 volatile
 * 字段，宿主也据此在配置变化时原地热更新而不是整行重挂载。组内叶子字段
 * 不能再标 volatile（schemastery 不允许嵌套 volatile）。
 */
export const Config = z.object({
  sources: z.array(source).default([DEFAULT_SOURCE]).volatile(),
  cache: z.object({
    ttlMs: z.number().min(1000).default(12000),
    errorTtlMs: z.number().min(500).default(5000),
    timeoutMs: z.number().min(500).default(8000),
  }).default({}).volatile(),
  display: z.object({
    title: z.string(),
    pillSource: z.string(),
    pillMeter: z.string(),
    placement: z.union(['bottom-right', 'bottom-left']).default('bottom-right'),
    pollMs: z.number().min(5000).default(20000),
    showUsage: z.boolean().default(true),
  }).default({}).volatile(),
})

/** 支持月度预算的 driver；配置页据此决定是否显示 budget 字段。 */
const BUDGET_DRIVERS = new Set(['anthropic-usage', 'openai-usage'])

/**
 * 从适配器注册表派生配置页需要的驱动器元信息，避免浏览器侧再抄一份列表。
 * @returns {Array<Record<string, unknown>>} 每个 driver 的展示名与默认值。
 */
export function driverCatalog() {
  return DRIVER_IDS.map((id) => {
    const adapter = DRIVERS[id]
    return {
      id,
      label: adapter.label,
      labelKey: adapter.labelKey,
      defaultCredential: adapter.defaults.credential ?? null,
      defaultBaseUrl: adapter.defaults.baseUrl ?? null,
      supportsBudget: BUDGET_DRIVERS.has(id),
      isHttp: id === 'http',
    }
  })
}

/**
 * 读取一个字段的真值：volatile 字段是带 `.get()` 的引用，普通字段原样返回。
 * @param {unknown} value 配置字段。
 * @returns {unknown} 解包后的值。
 */
function readField(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value
}

/**
 * 把 Loader 传入的配置解包成普通对象；缺失的组留给 schema 补默认值。
 * @param {Record<string, any>} [input] 插件配置（可能含 volatile 引用）。
 * @returns {{ sources: unknown, cache: unknown, display: unknown }} 普通值。
 */
export function unwrapConfig(input = {}) {
  const raw = input ?? {}
  return {
    sources: readField(raw.sources),
    cache: readField(raw.cache),
    display: readField(raw.display),
  }
}

/**
 * 解包、补默认值并做跨字段校验。宿主 apply 与测试都用它拿纯对象配置。
 * @param {Record<string, any>} [input] 插件配置（可能含 volatile 引用）。
 * @returns {{ sources: Array<Record<string, any>>, cache: Record<string, any>, display: Record<string, any> }} 已校验的配置。
 */
export function resolveConfig(input = {}) {
  const parsed = Config(unwrapConfig(input))
  const resolved = unwrapConfig(parsed)
  validateConfig(resolved)
  return resolved
}

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
