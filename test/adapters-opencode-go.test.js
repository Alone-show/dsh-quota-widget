import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateKey } from '../lib/quota.js'
import { QuotaError } from '../lib/errors.js'
import { adapterContext, opencodeResponses, rejected } from './helpers.js'
import * as opencode from '../lib/adapters/opencode-go.js'

const now = new Date('2026-11-06T04:00:00Z')
const today = localDateKey(now)
const source = { id: 'o', driver: 'opencode-go', credential: 'OPENCODE_GO_API_KEY', baseUrl: 'https://opencode.example/api' }

test('opencode-go maps plan, three meters and today usage', async () => {
  const responses = opencodeResponses(today)
  const ctx = adapterContext(async (url) => {
    if (url.endsWith('/go/status')) return responses.status
    if (url.endsWith('/activity/go')) return responses.activity
    throw new Error(`unexpected url ${url}`)
  }, { now })

  const result = await opencode.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.plan.label, 'Go')
  assert.equal(result.meters.length, 3)
  const month = result.meters.find((meter) => meter.key === 'month')
  assert.equal(month.primary, true)
  assert.equal(month.showValue, false)
  assert.equal(month.limit, 60)
  assert.equal(month.used, 11.5)
  assert.equal(month.percent, 19.166666666666668)
  assert.equal(result.usage.tokens, 168885802)
  assert.equal(result.usage.requests, 1100)
  assert.equal(result.notice, null)
})

test('opencode-go reports non-go plans without meters', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.endsWith('/go/status')) return { product: 'free', access: {} }
    if (url.endsWith('/activity/go')) return { daily: [] }
    throw new Error('unexpected')
  }, { now })

  const result = await opencode.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 0)
  assert.equal(result.notice, 'non-go')
  assert.equal(result.usage, null)
})

test('opencode-go keeps today usage when status fails but activity succeeds', async () => {
  const responses = opencodeResponses(today)
  const ctx = adapterContext(async (url) => {
    if (url.endsWith('/go/status')) throw new QuotaError('upstream', 'boom')
    if (url.endsWith('/activity/go')) return responses.activity
    throw new Error('unexpected')
  }, { now })

  const result = await opencode.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 0)
  assert.equal(result.notice, 'unknown')
  assert.equal(result.usage.tokens, 168885802)
})

test('opencode-go surfaces 401 as credential-rejected', async () => {
  const ctx = adapterContext(async (url) => {
    if (url.endsWith('/go/status')) throw rejected()
    return { daily: [] }
  }, { now })

  await assert.rejects(() => opencode.read(source, ctx), (error) => error.code === 'credential-rejected')
})

test('opencode-go reports a missing credential', async () => {
  const ctx = adapterContext(async () => ({}), { now, missing: 'OPENCODE_GO_API_KEY' })
  await assert.rejects(() => opencode.read(source, ctx), (error) => error.code === 'missing-credential' && error.ref === 'OPENCODE_GO_API_KEY')
})
