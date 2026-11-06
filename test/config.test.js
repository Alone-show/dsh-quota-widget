import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, buildDisplay, driverCatalog, normalizeSources, resolveConfig } from '../lib/config.js'

test('Config applies defaults', () => {
  const config = resolveConfig({})
  assert.equal(config.sources.length, 1)
  assert.equal(config.sources[0].id, 'opencode-go')
  assert.equal(config.sources[0].credential, 'OPENCODE_GO_API_KEY')
  assert.equal(config.cache.ttlMs, 12000)
  assert.equal(config.display.placement, 'bottom-right')
  assert.equal(config.display.pollMs, 20000)
})

test('Config marks the editable groups volatile without nested volatile fields', () => {
  const { dict } = Config
  assert.equal(dict.sources.meta.volatile, true)
  assert.equal(dict.cache.meta.volatile, true)
  assert.equal(dict.display.meta.volatile, true)
  // schemastery 不允许 volatile 内再嵌 volatile；数组/对象的子字段必须保持普通。
  assert.equal(dict.sources.inner.meta.volatile, undefined)
  assert.equal(dict.cache.dict.ttlMs.meta.volatile, undefined)
  assert.equal(dict.display.dict.pollMs.meta.volatile, undefined)
})

test('resolveConfig unwraps the volatile references the Loader passes in', () => {
  const parsed = Config({})
  assert.equal(typeof parsed.sources.get, 'function')
  assert.equal(Array.isArray(parsed.sources.get()), true)

  const resolved = resolveConfig(parsed)
  assert.equal(Array.isArray(resolved.sources), true)
  assert.equal(resolved.sources[0].id, 'opencode-go')
  assert.equal(typeof resolved.cache.ttlMs, 'number')
  assert.equal(resolved.display.placement, 'bottom-right')
})

test('Config rejects duplicate source ids', () => {
  assert.throws(
    () =>
      resolveConfig({
        sources: [
          { id: 'a', driver: 'opencode-go' },
          { id: 'a', driver: 'deepseek-balance' },
        ],
      }),
    /duplicate source id/,
  )
})

test('Config rejects http sources without a url or with a bad protocol', () => {
  assert.throws(() => resolveConfig({ sources: [{ id: 'x', driver: 'http' }] }), /requires a url/)

  assert.throws(
    () => resolveConfig({ sources: [{ id: 'x', driver: 'http', url: 'ftp://example.com/quota' }] }),
    /http or https/,
  )
})

test('Config rejects budgets on non-cost drivers', () => {
  assert.throws(
    () => resolveConfig({ sources: [{ id: 'o', driver: 'opencode-go', budget: { amount: 10 } }] }),
    /does not support budget/,
  )
})

test('Config requires USD budgets for cost drivers', () => {
  assert.throws(
    () =>
      resolveConfig({
        sources: [{ id: 'a', driver: 'anthropic-usage', budget: { amount: 10, currency: 'CNY' } }],
      }),
    /currency must be USD/,
  )
})

test('Config rejects a pillSource that does not exist', () => {
  assert.throws(
    () => resolveConfig({ sources: [{ id: 'a', driver: 'opencode-go' }], display: { pillSource: 'nope' } }),
    /does not match any source id/,
  )
})

test('normalizeSources applies adapter defaults and filters disabled sources', () => {
  const config = resolveConfig({
    sources: [
      { id: 'a', driver: 'deepseek-balance' },
      { id: 'b', driver: 'openai-usage', enabled: false },
    ],
  })
  const sources = normalizeSources(config.sources)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].label, 'DeepSeek')
  assert.equal(sources[0].labelKey, 'source.deepseek')
  assert.equal(sources[0].baseUrl, 'https://api.deepseek.com')
  assert.equal(sources[0].credential, 'DEEPSEEK_API_KEY')
})

test('normalizeSources keeps a custom label without a labelKey', () => {
  const config = resolveConfig({ sources: [{ id: 'a', driver: 'deepseek-balance', label: '我的余额' }] })
  const sources = normalizeSources(config.sources)
  assert.equal(sources[0].label, '我的余额')
  assert.equal(sources[0].labelKey, undefined)
})

test('buildDisplay removes empty strings', () => {
  const display = buildDisplay({ title: '', pillSource: '', pillMeter: '', placement: 'bottom-left', pollMs: 20000, showUsage: false })
  assert.equal(display.title, null)
  assert.equal(display.pillSource, null)
  assert.equal(display.pillMeter, null)
  assert.equal(display.placement, 'bottom-left')
  assert.equal(display.showUsage, false)
})

test('driverCatalog describes every driver exactly once', () => {
  const catalog = driverCatalog()
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ['opencode-go', 'deepseek-balance', 'anthropic-usage', 'openai-usage', 'http'],
  )
  const opencode = catalog.find((entry) => entry.id === 'opencode-go')
  assert.equal(opencode.label, 'OpenCode Go')
  assert.equal(opencode.labelKey, 'source.opencode-go')
  assert.equal(opencode.defaultCredential, 'OPENCODE_GO_API_KEY')
  assert.equal(opencode.defaultBaseUrl, 'https://opencode.ai/console/api')
  assert.equal(opencode.supportsBudget, false)
  assert.equal(opencode.isHttp, false)

  const http = catalog.find((entry) => entry.id === 'http')
  assert.equal(http.isHttp, true)
  assert.equal(http.defaultCredential, null)
  assert.equal(http.supportsBudget, false)

  assert.deepEqual(
    catalog.filter((entry) => entry.supportsBudget).map((entry) => entry.id),
    ['anthropic-usage', 'openai-usage'],
  )
})
