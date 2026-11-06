import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateKey } from '../lib/quota.js'
import { QuotaError } from '../lib/errors.js'
import { adapterContext, rejected } from './helpers.js'
import * as anthropic from '../lib/adapters/anthropic-usage.js'

const now = new Date('2026-11-06T04:00:00Z')
const today = localDateKey(now)
const baseSource = { id: 'a', driver: 'anthropic-usage', credential: 'ANTHROPIC_ADMIN_KEY', baseUrl: 'https://anthropic.example' }

const costBody = {
  data: [
    { starting_at: '2026-11-01T00:00:00Z', results: [{ amount: '1000' }] },
    { starting_at: '2026-11-06T00:00:00Z', results: [{ amount: '250' }] },
  ],
}

const usageBody = {
  data: [
    {
      starting_at: '2026-11-06T00:00:00Z',
      results: [
        {
          uncached_input_tokens: 100,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
          output_tokens: 75,
        },
      ],
    },
  ],
}

function context() {
  return adapterContext(async (url, headers) => {
    assert.equal(headers['x-api-key'], 'value-ANTHROPIC_ADMIN_KEY')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    if (url.includes('/cost_report')) return costBody
    if (url.includes('/usage_report/messages')) return usageBody
    throw new Error(`unexpected url ${url}`)
  }, { now })
}

test('anthropic-usage converts cents, sums tokens and applies the budget', async () => {
  const source = { ...baseSource, budget: { amount: 200 } }
  const result = await anthropic.read(source, context())
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 1)
  const meter = result.meters[0]
  assert.equal(meter.key, 'monthCost')
  assert.equal(meter.used, 12.5)
  assert.equal(meter.limit, 200)
  assert.equal(meter.percent, 6.25)
  assert.equal(meter.primary, true)
  assert.equal(result.usage.tokens, 250)
  assert.equal(result.usage.costUsd, 2.5)
  assert.equal(result.notice, null)
})

test('anthropic-usage shows cost as value when no budget is configured', async () => {
  const result = await anthropic.read(baseSource, context())
  const meter = result.meters[0]
  assert.equal(meter.used, 12.5)
  assert.equal(meter.limit, undefined)
  assert.equal(meter.percent, undefined)
  assert.equal(meter.value, 12.5)
})

test('anthropic-usage tolerates one failed sub-request', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.includes('/cost_report')) throw new QuotaError('upstream', 'cost failed')
    return usageBody
  }, { now })
  const result = await anthropic.read(baseSource, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 0)
  assert.equal(result.notice, 'partial')
  assert.equal(result.usage.tokens, 250)
})

test('anthropic-usage surfaces 401 as credential-rejected', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.includes('/cost_report')) throw rejected()
    return usageBody
  }, { now })
  await assert.rejects(() => anthropic.read(baseSource, ctx), (error) => error.code === 'credential-rejected')
})

test('anthropic-usage reports missing credentials', async () => {
  const ctx = adapterContext(async () => ({}), { now, missing: 'ANTHROPIC_ADMIN_KEY' })
  await assert.rejects(() => anthropic.read(baseSource, ctx), (error) => error.code === 'missing-credential')
})
