/**
 * 通用 HTTP 适配器。
 *
 * 两种输入：
 *   1. 不配 mapping：上游直接返回标准化契约 { plan?, meters[], usage? }；
 *   2. 配 mapping：用点号路径从任意 JSON 中取 meter / plan / usage 字段。
 *
 * 只支持 GET。需要聚合或多请求的提供方用内置 adapter 或自建代理。
 */

import { ERROR_CODES, QuotaError, requireCredential } from '../errors.js'
import { METER_UNITS, buildMeter, finiteNumber, monthWindow, normalizeExternalMeter, normalizePlan, normalizeUsage } from '../quota.js'
import { getNumber, getPath } from '../paths.js'

export const id = 'http'
export const label = 'HTTP'
export const labelKey = 'source.http'
export const defaults = {
  baseUrl: undefined,
  credential: undefined,
}

/**
 * 展开 URL / header / query 里的时间占位符。
 * @param {string} text 原始文本。
 * @param {Date} now 当前时间。
 * @returns {string} 展开后的文本。
 */
function expand(text, now) {
  const window = monthWindow(now)
  return String(text)
    .replaceAll('{now}', window.endIso)
    .replaceAll('{monthStart}', window.startIso)
    .replaceAll('{nowUnix}', String(window.endUnix))
    .replaceAll('{monthStartUnix}', String(window.startUnix))
}

/**
 * 把 header 名统一成小写，避免和认证头大小写冲突。
 * @param {Record<string, string>} headers 原始头。
 * @returns {Record<string, string>} 小写键头。
 */
function lowerHeaders(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key.toLowerCase()] = value
  }
  return result
}

/**
 * 组装通用 HTTP 请求头。
 * @param {Record<string, any>} source 数据源配置。
 * @param {{ resolveCredential: Function }} ctx 适配器上下文。
 * @param {Date} now 当前时间。
 * @returns {Promise<Record<string, string>>} 请求头。
 */
async function buildHeaders(source, ctx, now) {
  const headers = lowerHeaders(source.headers)
  for (const [key, value] of Object.entries(headers)) {
    headers[key] = expand(value, now)
  }

  const type = source.auth?.type ?? 'bearer'
  if (type === 'none') return headers

  const ref = source.credential
  const key = requireCredential(
    ref === undefined ? undefined : await ctx.resolveCredential(ref),
    ref ?? 'credential',
  )
  if (type === 'bearer') {
    headers.authorization = `Bearer ${key}`
  } else {
    const header = String(source.auth?.header ?? 'Authorization').toLowerCase()
    headers[header] = `${source.auth?.prefix ?? ''}${key}`
  }
  return headers
}

/**
 * 组装请求 URL，展开 query 占位符。
 * @param {Record<string, any>} source 数据源配置。
 * @param {Date} now 当前时间。
 * @returns {string} 完整 URL。
 */
function buildUrl(source, now) {
  const url = new URL(expand(source.url, now))
  for (const [key, value] of Object.entries(source.query ?? {})) {
    url.searchParams.set(key, expand(value, now))
  }
  return url.toString()
}

/**
 * 取数字字段；number 视为字面量，string 视为路径。
 * @param {unknown} root 根对象。
 * @param {string | number | undefined} path 路径或字面量。
 * @param {number} scale 缩放。
 * @returns {number | undefined} 数字。
 */
function numericAt(root, path, scale) {
  const number = typeof path === 'number' ? finiteNumber(path) : getNumber(root, path)
  return number === undefined ? undefined : number * scale
}

/**
 * 取字符串字段。
 * @param {unknown} root 根对象。
 * @param {string | undefined} path 路径。
 * @returns {string | undefined} 字符串。
 */
function stringAt(root, path) {
  const value = getPath(root, path)
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 解析 unit：先看是不是合法的字面量，否则当路径。
 * @param {unknown} item meter 元素。
 * @param {string | undefined} spec 字段配置。
 * @returns {string} 合法单位。
 */
function unitAt(item, spec) {
  if (spec === undefined || spec === '') return 'count'
  if (METER_UNITS.includes(spec)) return spec
  const value = getPath(item, spec)
  return typeof value === 'string' && METER_UNITS.includes(value) ? value : 'count'
}

/**
 * 解析 currency：三字母代码视为字面量，否则当路径。
 * @param {unknown} item meter 元素。
 * @param {string | undefined} spec 字段配置。
 * @returns {string | undefined} 币种。
 */
function currencyAt(item, spec) {
  if (spec === undefined || spec === '') return undefined
  if (/^[A-Za-z]{3}$/.test(spec)) return spec.toUpperCase()
  const value = getPath(item, spec)
  return typeof value === 'string' && value !== '' ? value.toUpperCase() : undefined
}

/**
 * 从数组元素 + fields 映射构造 meter。
 * @param {unknown} item 数组元素。
 * @param {Record<string, any>} fields 字段映射。
 * @param {number} index 下标。
 * @param {number} baseScale 数据源级缩放。
 * @returns {Record<string, unknown> | undefined} meter。
 */
function meterFromFields(item, fields, index, baseScale) {
  const scale = (finiteNumber(fields.scale) ?? 1) * baseScale
  const rawKey = getPath(item, fields.key ?? 'key')
  const key = rawKey === undefined || rawKey === null || rawKey === ''
    ? `meter-${index + 1}`
    : String(rawKey)
  const labelValue = getPath(item, fields.label)
  const currencyPath = fields.currencyPath ? stringAt(item, fields.currencyPath) : undefined

  return buildMeter({
    key,
    label: typeof labelValue === 'string' && labelValue !== '' ? labelValue : undefined,
    used: numericAt(item, fields.used, scale),
    limit: numericAt(item, fields.limit, scale),
    value: numericAt(item, fields.value, scale),
    percent: numericAt(item, fields.percent, 1),
    resetsAt: stringAt(item, fields.resetsAt),
    startsAt: stringAt(item, fields.startsAt),
    unit: unitAt(item, fields.unit),
    currency: currencyPath ?? currencyAt(item, fields.currency),
    primary: index === 0,
  })
}

/**
 * 从显式 MeterDef 构造 meter。
 * @param {Record<string, any>} body 响应体。
 * @param {Record<string, any>} def meter 定义。
 * @param {number} baseScale 数据源级缩放。
 * @returns {Record<string, unknown> | undefined} meter。
 */
function meterFromDef(body, def, baseScale) {
  const scale = (finiteNumber(def.scale) ?? 1) * baseScale
  return buildMeter({
    key: def.key,
    label: def.label,
    used: numericAt(body, def.used, scale),
    limit: numericAt(body, def.limit, scale),
    value: numericAt(body, def.value, scale),
    percent: numericAt(body, def.percent, 1),
    resetsAt: stringAt(body, def.resetsAt),
    startsAt: stringAt(body, def.startsAt),
    unit: def.unit,
    currency: def.currencyPath ? stringAt(body, def.currencyPath) : def.currency,
    showValue: def.showValue,
    primary: def.primary,
  })
}

/**
 * 按 mapping 取 meters。
 * @param {Record<string, any>} body 响应体。
 * @param {Record<string, any>} mapping 映射配置。
 * @param {number} baseScale 数据源级缩放。
 * @returns {Array<Record<string, unknown>>} meters。
 */
function mappedMeters(body, mapping, baseScale) {
  if (typeof mapping.meters === 'string') {
    const list = getPath(body, mapping.meters)
    if (!Array.isArray(list)) {
      throw new QuotaError('config', `mapping.meters "${mapping.meters}" did not resolve to an array`)
    }
    return list
      .map((item, index) => meterFromFields(item, mapping.fields ?? {}, index, baseScale))
      .filter(Boolean)
  }

  if (Array.isArray(mapping.meters)) {
    return mapping.meters.map((def) => meterFromDef(body, def, baseScale)).filter(Boolean)
  }

  throw new QuotaError('config', 'mapping.meters is missing')
}

/**
 * 按 mapping 取 plan。
 * @param {Record<string, any>} body 响应体。
 * @param {Record<string, any>} mapping 映射配置。
 * @returns {Record<string, unknown> | null} plan。
 */
function mappedPlan(body, mapping) {
  const plan = mapping.plan
  if (plan === undefined) return null
  return normalizePlan({
    label: stringAt(body, plan.label),
    startsAt: stringAt(body, plan.startsAt),
    endsAt: stringAt(body, plan.endsAt),
    cancelAtPeriodEnd: getPath(body, plan.cancelAtPeriodEnd) === true,
  })
}

/**
 * 按 mapping 取 usage。
 * @param {Record<string, any>} body 响应体。
 * @param {Record<string, any>} mapping 映射配置。
 * @returns {Record<string, unknown> | null} usage。
 */
function mappedUsage(body, mapping) {
  const usage = mapping.usage
  if (usage === undefined) return null
  return normalizeUsage({
    label: stringAt(body, usage.label),
    tokens: numericAt(body, usage.tokens, 1),
    requests: numericAt(body, usage.requests, 1),
    costUsd: numericAt(body, usage.costUsd, 1),
    date: stringAt(body, usage.date),
  })
}

/**
 * 读取通用 HTTP 数据源。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const headers = await buildHeaders(source, ctx, now)
  const body = await ctx.request(buildUrl(source, now), headers)

  if (body.ok === false) {
    const code = ERROR_CODES.includes(body.error?.code) ? body.error.code : 'upstream'
    throw new QuotaError(code, String(body.error?.message ?? 'upstream reported failure'))
  }

  if (source.mapping !== undefined) {
    const mapping = source.mapping
    return {
      ok: true,
      plan: mappedPlan(body, mapping),
      meters: mappedMeters(body, mapping, source.scale ?? 1),
      usage: mappedUsage(body, mapping),
      notice: typeof body.notice === 'string' ? body.notice : null,
      error: null,
    }
  }

  if (!Array.isArray(body.meters)) {
    throw new QuotaError('upstream', 'normalized response requires a meters array')
  }

  return {
    ok: true,
    plan: normalizePlan(body.plan),
    meters: body.meters.map((item, index) => normalizeExternalMeter(item, index)).filter(Boolean),
    usage: normalizeUsage(body.usage),
    notice: typeof body.notice === 'string' ? body.notice : null,
    error: null,
  }
}
