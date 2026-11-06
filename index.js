/**
 * 额度浮窗 —— 宿主半侧。
 *
 * 只做一件事：把各数据源的额度 / 用量搬到本机同源路由上，供浏览器半侧轮询。
 *
 *   GET /plugins/quota-widget          读取（命中缓存则不发上游请求）
 *   GET /plugins/quota-widget?force=1  跳过缓存，强制刷新（浮窗里的刷新按钮）
 *   GET /plugins/quota-widget?meta=1   只回驱动器元信息，不请求上游（插件页配置表单用）
 *
 * 为什么不直接让浏览器请求上游：
 *   1. 各服务商的额度接口不返回跨域许可，浏览器会被 CORS 挡掉；
 *   2. 凭据只应留在宿主侧，绝不能下发到页面。
 *
 * 数据来源由配置里的 sources 决定，具体适配器见 lib/adapters/。
 * 返回体里剥离账号标识，只向前端暴露额度本身。
 *
 * 配置三个顶层组都是 volatile：插件页保存后 Loader 原地提交新值并发出
 * loader/volatile-update，这里据此重建运行时，避免整行重挂载导致路由抖动。
 */

import { Config, buildDisplay, driverCatalog, normalizeSources, resolveConfig } from './lib/config.js'
import { createSnapshotter } from './lib/snapshot.js'

export { Config }

/** 同源只读路由，client.js 里的 ENDPOINT 必须和它一致。 */
const ROUTE_PATH = '/plugins/quota-widget'

/** 依赖的宿主服务：HTTP 载体 + 凭据缝。 */
export const inject = ['webServer', 'credentials']

/** 插件名，便于诊断。 */
export const name = 'quota-widget'

/**
 * 取凭据：先走凭据缝，再退回环境变量。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主插件上下文。
 * @param {string | undefined} ref 凭据引用名。
 * @returns {Promise<string | undefined>} 密钥明文（只在宿主进程内使用）。
 */
async function resolveCredential(ctx, ref) {
  if (typeof ref !== 'string' || ref === '') return undefined
  try {
    const resolved = await ctx.credentials.resolve(ref)
    if (resolved && typeof resolved.value === 'string' && resolved.value !== '') {
      return resolved.value
    }
  } catch {
    /* 凭据服务不可用时退回环境变量，不阻断插件 */
  }
  const ambient = process.env[ref]
  return typeof ambient === 'string' && ambient !== '' ? ambient : undefined
}

/**
 * 用一份配置造出路由需要的运行时。
 * 配置变化时整个换掉，顺带清空上一次的快照缓存。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主插件上下文。
 * @param {Record<string, any>} config 插件配置（可能含 volatile 引用）。
 * @returns {{ display: Record<string, unknown>, snapshotter: { read: (force: boolean) => Promise<Record<string, any>> } }} 运行时。
 */
function createRuntime(ctx, config) {
  const resolved = resolveConfig(config ?? {})
  const display = buildDisplay(resolved.display)
  const snapshotter = createSnapshotter({
    sources: normalizeSources(resolved.sources),
    display,
    cache: resolved.cache,
    resolveCredential: (ref) => resolveCredential(ctx, ref),
  })
  return { display, snapshotter }
}

/**
 * 挂载路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主插件上下文。
 * @param {Record<string, any>} [config] 插件配置。
 */
export function apply(ctx, config = {}) {
  let runtime = createRuntime(ctx, config)

  // 配置页保存后 Loader 只提交 volatile 值，不会重挂载本插件；这里重建运行时，
  // 让下一轮轮询（或浮窗的立即刷新事件）用上新配置。跨字段非法时保留旧运行时。
  ctx.on('loader/volatile-update', () => {
    try {
      runtime = createRuntime(ctx, config)
    } catch (error) {
      ctx.logger?.warn?.('quota-widget: 配置更新未生效', error)
    }
  })

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('allow', 'GET, HEAD')
            res.end()
            return
          }

          let url
          try {
            url = new URL(String(req.url), 'http://localhost')
          } catch {
            url = null
          }

          // 配置页打开时只问驱动器和默认值，不触发上游请求。
          if (url?.searchParams.get('meta') === '1') {
            const meta = JSON.stringify({ ok: true, catalog: driverCatalog() })
            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(req.method === 'HEAD' ? undefined : meta)
            return
          }

          const force = url?.searchParams.get('force') === '1'

          let payload
          try {
            payload = await runtime.snapshotter.read(force)
          } catch (error) {
            payload = {
              ok: false,
              fetchedAt: new Date().toISOString(),
              display: runtime.display,
              sources: [],
              error: {
                code: 'upstream',
                message: error instanceof Error ? error.message : String(error),
              },
            }
          }

          const body = JSON.stringify(payload)
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(req.method === 'HEAD' ? undefined : body)
        },
      }),
    `quota-widget: GET ${ROUTE_PATH}`,
  )
}
