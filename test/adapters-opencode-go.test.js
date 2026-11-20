import test from 'node:test'
import assert from 'node:assert/strict'
import { QuotaError } from '../lib/errors.js'
import { adapterContext, opencodeUsage, rejected } from './helpers.js'
import * as opencode from '../lib/adapters/opencode-go.js'

const now = new Date('2026-11-06T04:00:00Z')
const source = { id: 'o', driver: 'opencode-go', credential: 'OPENCODE_GO_API_KEY', baseUrl: 'https://opencode.example/go/v1' }

test('opencode-go maps the three public usage windows', async () => {
  const body = opencodeUsage()
  let requested
  const ctx = adapterContext(async (url, headers) => {
    requested = { url, headers }
    return body
  }, { now })

  const result = await opencode.read(source, ctx)
  assert.equal(requested.url, 'https://opencode.example/go/v1/usage')
  assert.equal(requested.headers.authorization, 'Bearer value-OPENCODE_GO_API_KEY')
  assert.equal(result.ok, true)
  assert.equal(result.plan, null)
  assert.equal(result.usage, null)
  assert.equal(result.notice, null)
  assert.equal(result.meters.length, 3)

  const month = result.meters.find((meter) => meter.key === 'month')
  assert.equal(month.primary, true)
  assert.equal(month.showValue, false)
  assert.equal(month.percent, 19.166666666666668)
  assert.equal(month.resetsAt, '2026-11-20T04:00:05.000Z')

  const fiveHour = result.meters.find((meter) => meter.key === 'fiveHour')
  assert.equal(fiveHour.percent, 12)
  assert.equal(fiveHour.unit, 'percent')
})

test('opencode-go reports partial when a window is missing', async () => {
  const ctx = adapterContext(async () => ({
    usage: {
      rolling: { status: 'ok', percent: 5, resetsAt: '2026-11-06T07:00:00.000Z' },
    },
  }), { now })

  const result = await opencode.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 1)
  assert.equal(result.notice, 'partial')
})

test('opencode-go reports unknown when every window is missing', async () => {
  const ctx = adapterContext(async () => ({ usage: {} }), { now })

  const result = await opencode.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 0)
  assert.equal(result.notice, 'unknown')
})

test('opencode-go rejects a response without a usage object', async () => {
  const ctx = adapterContext(async () => ({ ok: true }), { now })

  await assert.rejects(
    () => opencode.read(source, ctx),
    (error) => error instanceof QuotaError && error.code === 'upstream',
  )
})

test('opencode-go surfaces 401 as credential-rejected', async () => {
  const ctx = adapterContext(async () => {
    throw rejected()
  }, { now })

  await assert.rejects(() => opencode.read(source, ctx), (error) => error.code === 'credential-rejected')
})

test('opencode-go reports a missing credential', async () => {
  const ctx = adapterContext(async () => ({}), { now, missing: 'OPENCODE_GO_API_KEY' })
  await assert.rejects(() => opencode.read(source, ctx), (error) => error.code === 'missing-credential' && error.ref === 'OPENCODE_GO_API_KEY')
})
