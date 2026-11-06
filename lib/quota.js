/**
 * 额度数据的通用归一化：meter、plan、日期窗口。
 *
 * 适配器只负责把上游字段读出来，统一在这里变成客户端可渲染的形状：
 * `percent` 有值就画进度条，没有 `percent` 但有 `value` 就显示数值（余额场景）。
 */

/** 允许的 meter 单位。 */
export const METER_UNITS = ['usd', 'currency', 'percent', 'count', 'tokens', 'requests']

/**
 * 把一个可能为 undefined / 字符串的数值收敛成有限数字。
 * @param {unknown} value 原始值。
 * @returns {number | undefined} 有限数字，否则 undefined。
 */
export function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/,/g, '')
  if (text === '') return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}

/**
 * 百分比夹到 0–100。
 * @param {number} value 任意百分比。
 * @returns {number} 0–100。
 */
export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * 计算已用百分比；limit 无效时为 undefined。
 * @param {number | undefined} used 已用量。
 * @param {number | undefined} limit 额度上限。
 * @returns {number | undefined} 0–100，或 undefined（无额度语义）。
 */
export function percentOf(used, limit) {
  if (used === undefined || limit === undefined) return undefined
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return undefined
  return clampPercent(Math.min(limit, used) / limit * 100)
}

/**
 * microCent（1e-8 美元）转美元。
 * @param {unknown} value 接口里的字符串数字。
 * @returns {number} 美元金额；无法解析时为 0。
 */
export function microCentsToUsd(value) {
  const number = finiteNumber(value)
  return number === undefined ? 0 : number / 1e8
}

/**
 * 「分」的十进制字符串转美元。
 * @param {unknown} value 以分为单位的字符串或数字。
 * @returns {number} 美元金额。
 */
export function centsToUsd(value) {
  const number = finiteNumber(value)
  return number === undefined ? 0 : number / 100
}

/**
 * 去掉对象里的 undefined 字段，避免响应里出现大量空键。
 * @param {Record<string, unknown>} object 原始对象。
 * @returns {Record<string, unknown>} 清理后的对象。
 */
export function compact(object) {
  const result = {}
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * 构造一个归一化 meter。
 * @param {{
 *   key?: string,
 *   label?: string,
 *   labelKey?: string,
 *   labelParams?: Record<string, unknown>,
 *   used?: number | string,
 *   limit?: number | string,
 *   value?: number | string,
 *   percent?: number | string,
 *   unit?: string,
 *   currency?: string,
 *   showValue?: boolean,
 *   startsAt?: string,
 *   resetsAt?: string,
 *   primary?: boolean,
 * }} input 原始字段。
 * @returns {Record<string, unknown> | undefined} 归一化 meter；key 缺失时返回 undefined。
 */
export function buildMeter(input) {
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  if (key === '') return undefined

  const used = finiteNumber(input.used)
  const limit = finiteNumber(input.limit)
  let value = finiteNumber(input.value)
  let percent = finiteNumber(input.percent)
  if (percent === undefined) percent = percentOf(used, limit)
  if (percent !== undefined) percent = clampPercent(percent)
  if (percent === undefined && value === undefined && used !== undefined) value = used

  const unit = METER_UNITS.includes(input.unit ?? '') ? input.unit : 'count'
  const currency = typeof input.currency === 'string' && input.currency !== ''
    ? input.currency
    : unit === 'usd' || unit === 'currency'
      ? 'USD'
      : undefined

  return compact({
    key,
    label: typeof input.label === 'string' && input.label !== '' ? input.label : undefined,
    labelKey: typeof input.labelKey === 'string' && input.labelKey !== '' ? input.labelKey : undefined,
    labelParams: input.labelParams && typeof input.labelParams === 'object' ? input.labelParams : undefined,
    percent,
    used,
    limit,
    value,
    unit,
    currency,
    showValue: input.showValue === false ? false : true,
    startsAt: typeof input.startsAt === 'string' && input.startsAt !== '' ? input.startsAt : undefined,
    resetsAt: typeof input.resetsAt === 'string' && input.resetsAt !== '' ? input.resetsAt : undefined,
    primary: input.primary === true ? true : undefined,
  })
}

/**
 * 归一化标准化 HTTP 契约里的一个 meter。
 * @param {unknown} raw 上游 meter 对象。
 * @param {number} index 数组下标，用于缺省 key。
 * @returns {Record<string, unknown> | undefined} 归一化 meter。
 */
export function normalizeExternalMeter(raw, index) {
  if (raw === null || typeof raw !== 'object') return undefined
  return buildMeter({
    key: typeof raw.key === 'string' && raw.key !== '' ? raw.key : `meter-${index + 1}`,
    label: raw.label,
    labelKey: raw.labelKey,
    labelParams: raw.labelParams,
    used: raw.used,
    limit: raw.limit,
    value: raw.value,
    percent: raw.percent,
    unit: raw.unit,
    currency: raw.currency,
    showValue: raw.showValue,
    startsAt: raw.startsAt,
    resetsAt: raw.resetsAt,
    primary: raw.primary,
  })
}

/**
 * 归一化套餐信息。
 * @param {unknown} raw 上游 plan 对象。
 * @returns {Record<string, unknown> | null} 归一化 plan，没有任何字段时为 null。
 */
export function normalizePlan(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const plan = compact({
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : undefined,
    startsAt: typeof raw.startsAt === 'string' && raw.startsAt !== '' ? raw.startsAt : undefined,
    endsAt: typeof raw.endsAt === 'string' && raw.endsAt !== '' ? raw.endsAt : undefined,
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd === true ? true : undefined,
  })
  return Object.keys(plan).length === 0 ? null : plan
}

/**
 * 归一化 usage；没有可展示字段时返回 null。
 * @param {unknown} raw 上游 usage 对象。
 * @returns {Record<string, unknown> | null} 归一化 usage。
 */
export function normalizeUsage(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const usage = compact({
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : undefined,
    labelKey: typeof raw.labelKey === 'string' && raw.labelKey !== '' ? raw.labelKey : undefined,
    date: typeof raw.date === 'string' && raw.date !== '' ? raw.date : undefined,
    tokens: finiteNumber(raw.tokens),
    requests: finiteNumber(raw.requests),
    costUsd: finiteNumber(raw.costUsd),
    currency: typeof raw.currency === 'string' && raw.currency !== '' ? raw.currency : undefined,
  })
  return Object.keys(usage).length === 0 ? null : usage
}

/**
 * 当前 UTC 月的起止窗口。
 * @param {Date} now 当前时间。
 * @returns {{ startIso: string, endIso: string, startUnix: number, endUnix: number }} 窗口。
 */
export function monthWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return {
    startIso: start.toISOString(),
    endIso: now.toISOString(),
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(now.getTime() / 1000),
  }
}

/**
 * 本地日期 YYYY-MM-DD。
 * @param {Date} [date] 时间，默认现在。
 * @returns {string} 本地日期。
 */
export function localDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 从 Unix 秒得到本地日期 key。
 * @param {unknown} seconds Unix 秒。
 * @returns {string | undefined} 本地日期。
 */
export function localDateKeyFromUnix(seconds) {
  const number = finiteNumber(seconds)
  if (number === undefined) return undefined
  return localDateKey(new Date(number * 1000))
}

/**
 * 从 ISO 时间得到本地日期 key。
 * @param {unknown} iso ISO 时间。
 * @returns {string | undefined} 本地日期。
 */
export function localDateKeyFromIso(iso) {
  if (typeof iso !== 'string' || iso === '') return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return localDateKey(date)
}

/**
 * 去掉 base URL 末尾的斜杠。
 * @param {string} url 地址。
 * @returns {string} 无尾斜杠地址。
 */
export function trimBaseUrl(url) {
  return String(url).replace(/\/+$/, '')
}
