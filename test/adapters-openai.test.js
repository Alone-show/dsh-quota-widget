import test from 'node:test'
import assert from 'node:assert/strict'
import { QuotaError } from '../lib/errors.js'
import { adapterContext, rejected } from './helpers.js'
import * as openai from '../lib/adapters/openai-usage.js'

const now = new Date('2026-11-06T04:00:00Z')
const todayUnix = Math.floor(Date.UTC(2026, 10, 6, 1, 0, 0) / 1000)
const yesterdayUnix = todayUnix - 86400
const baseSource = { id: 'o', driver: 'openai-usage', credential: 'OPENAI_ADMIN_KEY', baseUrl: 'https://openai.example/v1' }

const costBody = {
  data: [
    { start_time: todayUnix, results: [{ amount: { value: 2.5 } }] },
    { start_time: yesterdayUnix, results: [{ amount: { value: 7.5 } }] },
  ],
}

const usageBody = {
  data: [
    {
      start_time: todayUnix,
      results: [{ input_tokens: 1000, output_tokens: 500, num_model_requests: 3 }],
    },
    {
      start_time: yesterdayUnix,
      results: [{ input_tokens: 9000, output_tokens: 4000, num_model_requests: 10 }],
    },
  ],
}

function context() {
  return adapterContext(async (url, headers) => {
    assert.equal(headers.authorization, 'Bearer value-OPENAI_ADMIN_KEY')
    if (url.includes('/organization/costs')) return costBody
    if (url.includes('/organization/usage/completions')) return usageBody
    throw new Error(`unexpected url ${url}`)
  }, { now })
}

test('openai-usage sums monthly cost and today usage, then applies the budget', async () => {
  const source = { ...baseSource, budget: { amount: 100 } }
  const result = await openai.read(source, context())
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 1)
  const meter = result.meters[0]
  assert.equal(meter.used, 10)
  assert.equal(meter.limit, 100)
  assert.equal(meter.percent, 10)
  assert.equal(meter.primary, true)
  assert.equal(result.usage.tokens, 1500)
  assert.equal(result.usage.requests, 3)
  assert.equal(result.usage.costUsd, 2.5)
  assert.equal(result.notice, null)
})

test('openai-usage supports flat results pages', async () => {
  const flat = {
    results: [
      {
        amount: { value: 1.5 },
        input_tokens: 10,
        output_tokens: 5,
        num_model_requests: 1,
      },
    ],
  }
  const ctx = adapterContext(async () => flat, { now })
  const result = await openai.read(baseSource, ctx)
  assert.equal(result.meters[0].used, 1.5)
  assert.equal(result.usage.tokens, 15)
  assert.equal(result.usage.requests, 1)
  assert.equal(result.usage.costUsd, 1.5)
})

test('openai-usage sends the optional organization header', async () => {
  const seen = []
  const ctx = adapterContext(async (url, headers) => {
    seen.push(headers)
    return url.includes('/costs') ? costBody : usageBody
  }, { now })
  await openai.read({ ...baseSource, organization: 'org_123' }, ctx)
  assert.equal(seen[0]['openai-organization'], 'org_123')
})

test('openai-usage tolerates one failed sub-request', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.includes('/organization/costs')) throw new QuotaError('upstream', 'costs failed')
    return usageBody
  }, { now })
  const result = await openai.read(baseSource, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 0)
  assert.equal(result.notice, 'partial')
  assert.equal(result.usage.tokens, 1500)
})

test('openai-usage surfaces 401 as credential-rejected', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.includes('/organization/costs')) throw rejected()
    return usageBody
  }, { now })
  await assert.rejects(() => openai.read(baseSource, ctx), (error) => error.code === 'credential-rejected')
})

test('openai-usage reports missing credentials', async () => {
  const ctx = adapterContext(async () => ({}), { now, missing: 'OPENAI_ADMIN_KEY' })
  await assert.rejects(() => openai.read(baseSource, ctx), (error) => error.code === 'missing-credential')
})
