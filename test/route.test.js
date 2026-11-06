import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { localDateKey } from '../lib/quota.js'
import { opencodeResponses } from './helpers.js'

const now = new Date('2026-11-06T04:00:00Z')
const today = localDateKey(now)

/**
 * 假宿主 context：捕获路由 handler。
 * @returns {Record<string, any>} context。
 */
function createContext() {
  let handler
  const ctx = {
    credentials: {
      resolve: async (ref) => (ref === 'MISSING' ? undefined : { value: `value-${ref}` }),
    },
    webServer: {
      register(options) {
        handler = options.handler
        return () => {}
      },
    },
    effect(fn) {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
  }
  Object.defineProperty(ctx, 'handler', { get: () => handler })
  return ctx
}

/**
 * 调一次路由 handler。
 * @param {Function} handler 路由 handler。
 * @param {{ method?: string, url?: string }} [options] 请求。
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>} 响应。
 */
function callRoute(handler, options = {}) {
  const method = options.method ?? 'GET'
  const url = options.url ?? '/plugins/quota-widget'
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      },
      end(body) {
        resolve({ status: this.statusCode, headers: this.headers, body: body ?? '' })
      },
    }
    Promise.resolve(handler({ method, url }, res)).catch(reject)
  })
}

/**
 * 安装假 fetch；返回恢复函数。
 * @param {(url: string) => Promise<Response>} impl 实现。
 * @returns {() => void} 恢复。
 */
function installFetch(impl) {
  const previous = globalThis.fetch
  globalThis.fetch = impl
  return () => {
    globalThis.fetch = previous
  }
}

/**
 * 造一个 JSON response。
 * @param {unknown} body 响应体。
 * @returns {Response} response。
 */
function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * OpenCode 的假上游。
 * @returns {{ fetch: (url: string) => Promise<Response>, count: () => number }} 上游。
 */
function opencodeFetch() {
  const responses = opencodeResponses(today)
  let count = 0
  return {
    count: () => count,
    fetch: async (url) => {
      count += 1
      const text = String(url)
      if (text.endsWith('/go/status')) return jsonResponse(responses.status)
      if (text.endsWith('/activity/go')) return jsonResponse(responses.activity)
      throw new Error(`unexpected url ${text}`)
    },
  }
}

test('route serves GET/HEAD and caches until force=1', async () => {
  const upstream = opencodeFetch()
  const restore = installFetch(upstream.fetch)
  try {
    const ctx = createContext()
    apply(ctx, { sources: [{ id: 'o', driver: 'opencode-go', credential: 'TEST_KEY' }] })

    const first = await callRoute(ctx.handler)
    assert.equal(first.status, 200)
    assert.equal(first.headers['content-type'], 'application/json; charset=utf-8')
    const payload = JSON.parse(first.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.sources.length, 1)
    assert.equal(payload.sources[0].ok, true)
    assert.equal(payload.sources[0].meters.length, 3)
    assert.equal(first.body.includes('value-TEST_KEY'), false)
    assert.equal(first.body.includes('authorization'), false)
    assert.equal(upstream.count(), 2)

    await callRoute(ctx.handler)
    assert.equal(upstream.count(), 2)

    await callRoute(ctx.handler, { url: '/plugins/quota-widget?force=1' })
    assert.equal(upstream.count(), 4)

    const head = await callRoute(ctx.handler, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
  } finally {
    restore()
  }
})

test('route rejects unsupported methods', async () => {
  const restore = installFetch(opencodeFetch().fetch)
  try {
    const ctx = createContext()
    apply(ctx, { sources: [{ id: 'o', driver: 'opencode-go', credential: 'TEST_KEY' }] })
    const response = await callRoute(ctx.handler, { method: 'POST' })
    assert.equal(response.status, 405)
    assert.equal(response.headers.allow, 'GET, HEAD')
  } finally {
    restore()
  }
})

test('one failing source does not hide the healthy one', async () => {
  const upstream = opencodeFetch()
  const restore = installFetch(upstream.fetch)
  try {
    const ctx = createContext()
    apply(ctx, {
      sources: [
        { id: 'missing', driver: 'deepseek-balance', credential: 'MISSING' },
        { id: 'ok', driver: 'opencode-go', credential: 'TEST_KEY' },
      ],
    })
    const response = await callRoute(ctx.handler)
    const payload = JSON.parse(response.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.sources.length, 2)
    const missing = payload.sources.find((source) => source.id === 'missing')
    const healthy = payload.sources.find((source) => source.id === 'ok')
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'missing-credential')
    assert.equal(missing.error.ref, 'MISSING')
    assert.equal(healthy.ok, true)
    assert.equal(healthy.meters.length, 3)
  } finally {
    restore()
  }
})

test('route reads multiple sources and carries display preferences', async () => {
  const responses = opencodeResponses(today)
  let count = 0
  const restore = installFetch(async (url) => {
    count += 1
    const text = String(url)
    if (text.endsWith('/go/status')) return jsonResponse(responses.status)
    if (text.endsWith('/activity/go')) return jsonResponse(responses.activity)
    if (text.endsWith('/user/balance')) {
      return jsonResponse({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '110.00' }],
      })
    }
    throw new Error(`unexpected url ${text}`)
  })
  try {
    const ctx = createContext()
    apply(ctx, {
      sources: [
        { id: 'opencode-go', driver: 'opencode-go', credential: 'TEST_KEY' },
        { id: 'deepseek', driver: 'deepseek-balance', credential: 'TEST_KEY' },
      ],
      display: { pillSource: 'deepseek', pillMeter: 'balance-cny' },
    })
    const response = await callRoute(ctx.handler)
    const payload = JSON.parse(response.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.sources.length, 2)
    assert.equal(payload.sources.every((source) => source.ok), true)
    assert.equal(payload.display.pillSource, 'deepseek')
    assert.equal(payload.display.pillMeter, 'balance-cny')
    assert.equal(payload.sources[1].meters[0].key, 'balance-cny')
    assert.equal(payload.sources[1].meters[0].value, 110)
    assert.equal(count, 3)
  } finally {
    restore()
  }
})

test('no enabled sources returns a no-sources payload', async () => {
  const restore = installFetch(async () => {
    throw new Error('should not fetch')
  })
  try {
    const ctx = createContext()
    apply(ctx, { sources: [] })
    const response = await callRoute(ctx.handler)
    const payload = JSON.parse(response.body)
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'no-sources')
    assert.deepEqual(payload.sources, [])
  } finally {
    restore()
  }
})
