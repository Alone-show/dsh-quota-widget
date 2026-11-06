import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, buildDisplay, normalizeSources, validateConfig } from '../lib/config.js'

test('Config applies defaults', () => {
  const config = Config({})
  assert.equal(config.sources.length, 1)
  assert.equal(config.sources[0].id, 'opencode-go')
  assert.equal(config.sources[0].credential, 'OPENCODE_GO_API_KEY')
  assert.equal(config.cache.ttlMs, 12000)
  assert.equal(config.display.placement, 'bottom-right')
  assert.equal(config.display.pollMs, 20000)
  validateConfig(config)
})

test('Config rejects duplicate source ids', () => {
  const config = Config({
    sources: [
      { id: 'a', driver: 'opencode-go' },
      { id: 'a', driver: 'deepseek-balance' },
    ],
  })
  assert.throws(() => validateConfig(config), /duplicate source id/)
})

test('Config rejects http sources without a url or with a bad protocol', () => {
  const missing = Config({ sources: [{ id: 'x', driver: 'http' }] })
  assert.throws(() => validateConfig(missing), /requires a url/)

  const bad = Config({ sources: [{ id: 'x', driver: 'http', url: 'ftp://example.com/quota' }] })
  assert.throws(() => validateConfig(bad), /http or https/)
})

test('Config rejects budgets on non-cost drivers', () => {
  const config = Config({
    sources: [{ id: 'o', driver: 'opencode-go', budget: { amount: 10 } }],
  })
  assert.throws(() => validateConfig(config), /does not support budget/)
})

test('Config requires USD budgets for cost drivers', () => {
  const config = Config({
    sources: [{ id: 'a', driver: 'anthropic-usage', budget: { amount: 10, currency: 'CNY' } }],
  })
  assert.throws(() => validateConfig(config), /currency must be USD/)
})

test('Config rejects a pillSource that does not exist', () => {
  const config = Config({ sources: [{ id: 'a', driver: 'opencode-go' }], display: { pillSource: 'nope' } })
  assert.throws(() => validateConfig(config), /does not match any source id/)
})

test('normalizeSources applies adapter defaults and filters disabled sources', () => {
  const config = Config({
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
  const config = Config({ sources: [{ id: 'a', driver: 'deepseek-balance', label: '我的余额' }] })
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
