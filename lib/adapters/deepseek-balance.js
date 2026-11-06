/**
 * DeepSeek 余额适配器。
 *
 * DeepSeek 官方只公开余额接口（/user/balance），没有额度或用量接口；
 * 因此这里只显示各币种余额，不计算百分比。
 */

import { requireCredential } from '../errors.js'
import { buildMeter } from '../quota.js'

export const id = 'deepseek-balance'
export const label = 'DeepSeek'
export const labelKey = 'source.deepseek'
export const defaults = {
  baseUrl: 'https://api.deepseek.com',
  credential: 'DEEPSEEK_API_KEY',
}

/**
 * 读取 DeepSeek 余额。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const ref = source.credential ?? defaults.credential
  const key = requireCredential(await ctx.resolveCredential(ref), ref)
  const baseUrl = String(source.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')
  const body = await ctx.request(`${baseUrl}/user/balance`, { authorization: `Bearer ${key}` })

  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const meters = []
  for (const info of infos) {
    if (info === null || typeof info !== 'object') continue
    const currency = typeof info.currency === 'string' && info.currency !== '' ? info.currency : 'CNY'
    const value = Number(info.total_balance)
    if (!Number.isFinite(value)) continue
    const meter = buildMeter({
      key: `balance-${currency.toLowerCase()}`,
      labelKey: 'meter.balance',
      labelParams: { currency },
      label: `${currency} balance`,
      value,
      unit: 'currency',
      currency,
      showValue: true,
      primary: meters.length === 0,
    })
    if (meter !== undefined) meters.push(meter)
  }

  return {
    ok: true,
    plan: null,
    meters,
    usage: null,
    notice: meters.length === 0 ? 'no-data' : body.is_available === false ? 'balance-empty' : null,
    error: null,
  }
}
