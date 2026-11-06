/**
 * 多数据源快照：并发读取、错误隔离、整体缓存与 singleflight。
 */

import { DRIVERS } from './adapters/index.js'
import { toSourceError } from './errors.js'
import { requestJson } from './request.js'

/**
 * 读取一个源；适配器异常收敛成该源自己的 error。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
async function readSource(source, ctx) {
  const adapter = DRIVERS[source.driver]
  const base = {
    id: source.id,
    label: source.label,
    labelKey: source.labelKey,
    driver: source.driver,
    ok: false,
    plan: null,
    meters: [],
    usage: null,
    notice: null,
    error: null,
  }

  try {
    const result = await adapter.read(source, ctx)
    return {
      ...base,
      ...result,
      id: source.id,
      label: source.label,
      labelKey: source.labelKey,
      driver: source.driver,
      ok: true,
      meters: Array.isArray(result.meters) ? result.meters : [],
      error: null,
    }
  } catch (error) {
    return {
      ...base,
      ok: false,
      error: toSourceError(error),
    }
  }
}

/**
 * 创建一个快照读取器。
 * @param {{
 *   sources: Array<Record<string, any>>,
 *   display: Record<string, unknown>,
 *   cache: { ttlMs: number, errorTtlMs: number, timeoutMs: number },
 *   resolveCredential: (ref: string | undefined) => Promise<string | undefined>,
 * }} options 快照选项。
 * @returns {{ read: (force: boolean) => Promise<Record<string, any>> }} 读取器。
 */
export function createSnapshotter(options) {
  const { sources, display, cache, resolveCredential } = options
  let cached
  let inflight

  /** 真正并发读取全部源。 */
  async function refresh() {
    if (sources.length === 0) {
      return {
        ok: false,
        fetchedAt: new Date().toISOString(),
        display,
        sources: [],
        error: { code: 'no-sources', message: 'no quota sources are enabled' },
      }
    }

    const now = new Date()
    const ctx = {
      request: (url, headers) => requestJson(url, headers, cache.timeoutMs),
      resolveCredential,
      now,
    }
    const results = await Promise.all(sources.map((source) => readSource(source, ctx)))
    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      display,
      sources: results,
      error: null,
    }
  }

  /**
   * 读快照：命中缓存直接返回；并发请求合并成一次上游调用。
   * @param {boolean} force 是否跳过缓存。
   * @returns {Promise<Record<string, any>>} 快照。
   */
  async function read(force) {
    if (!force && cached !== undefined && Date.now() - cached.at < cached.ttl) return cached.payload
    if (inflight !== undefined) return inflight

    const running = refresh()
      .then((payload) => {
        const allOk = payload.ok === true && payload.sources.every((source) => source.ok === true)
        cached = {
          at: Date.now(),
          ttl: allOk ? cache.ttlMs : cache.errorTtlMs,
          payload,
        }
        return payload
      })
      .finally(() => {
        inflight = undefined
      })

    inflight = running
    return running
  }

  return { read }
}
