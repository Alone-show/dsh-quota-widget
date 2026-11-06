import test from 'node:test'
import assert from 'node:assert/strict'
import { adapterContext, rejected } from './helpers.js'
import * as httpAdapter from '../lib/adapters/http.js'

const baseSource = {
  id: 'h',
  driver: 'http',
  credential: 'HTTP_KEY',
  url: 'https://gw.example/quota',
  auth: { type: 'bearer', header: 'Authorization', prefix: 'Bearer ' },
  headers: {},
  query: {},
  scale: 1,
}

test('http driver accepts a normalized contract', async () => {
  const ctx = adapterContext(async (url, headers) => {
    assert.equal(headers.authorization, 'Bearer value-HTTP_KEY')
    return {
      plan: { label: 'Pro', endsAt: '2026-12-01T00:00:00Z' },
      meters: [{ key: 'month', label: '本月', used: 5, limit: 10, unit: 'usd' }],
      usage: { tokens: 100, requests: 2 },
      notice: null,
    }
  })
  const result = await httpAdapter.read(baseSource, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.plan.label, 'Pro')
  assert.equal(result.meters[0].percent, 50)
  assert.equal(result.usage.tokens, 100)
})

test('http driver maps an array of meter objects', async () => {
  const source = {
    ...baseSource,
    mapping: {
      meters: 'data.windows',
      fields: { key: 'key', label: 'label', used: 'used', limit: 'limit', resetsAt: 'resets_at', unit: 'usd', scale: 1 },
    },
  }
  const ctx = adapterContext(async () => ({
    data: {
      windows: [
        { key: 'week', label: '本周', used: 1, limit: 4, resets_at: '2026-11-13T00:00:00Z' },
        { key: 'month', label: '本月', used: 8, limit: 20, resets_at: '2026-12-01T00:00:00Z' },
      ],
    },
  }))
  const result = await httpAdapter.read(source, ctx)
  assert.equal(result.meters.length, 2)
  assert.equal(result.meters[0].key, 'week')
  assert.equal(result.meters[0].percent, 25)
  assert.equal(result.meters[0].primary, true)
  assert.equal(result.meters[1].percent, 40)
})

test('http driver maps explicit meter definitions from the response root', async () => {
  const source = {
    ...baseSource,
    mapping: {
      meters: [
        { key: 'month', label: '本月', used: 'usage.month.used', limit: 'usage.month.limit', unit: 'usd', scale: 1, showValue: true, primary: true },
      ],
      plan: { label: 'plan.name', endsAt: 'plan.ends_at' },
      usage: { tokens: 'usage.today.tokens', requests: 'usage.today.requests' },
    },
  }
  const ctx = adapterContext(async () => ({
    plan: { name: 'Team', ends_at: '2026-12-01T00:00:00Z' },
    usage: { month: { used: 3, limit: 12 }, today: { tokens: 42, requests: 7 } },
  }))
  const result = await httpAdapter.read(source, ctx)
  assert.equal(result.plan.label, 'Team')
  assert.equal(result.meters[0].percent, 25)
  assert.equal(result.usage.tokens, 42)
  assert.equal(result.usage.requests, 7)
})

test('http driver supports custom and disabled auth headers', async () => {
  const seen = []
  const custom = {
    ...baseSource,
    auth: { type: 'header', header: 'X-Api-Key', prefix: 'Token ' },
  }
  await httpAdapter.read(custom, adapterContext(async (url, headers) => {
    seen.push(headers)
    return { meters: [] }
  }))
  assert.equal(seen[0]['x-api-key'], 'Token value-HTTP_KEY')

  const none = { ...baseSource, credential: undefined, auth: { type: 'none', header: 'Authorization', prefix: '' } }
  await httpAdapter.read(none, adapterContext(async (url, headers) => {
    seen.push(headers)
    return { meters: [] }
  }))
  assert.equal(seen[1].authorization, undefined)
})

test('http driver expands time placeholders in url and query', async () => {
  const calls = []
  const source = {
    ...baseSource,
    url: 'https://gw.example/quota?start={monthStart}',
    query: { now: '{now}' },
  }
  await httpAdapter.read(source, adapterContext(async (url) => {
    calls.push(url)
    return { meters: [] }
  }))
  assert.match(calls[0], /start=2026-11-01T00%3A00%3A00.000Z/)
  assert.match(calls[0], /now=2026-11-06T04%3A00%3A00.000Z/)
})

test('http driver reports a bad mapping path as a config error', async () => {
  const source = {
    ...baseSource,
    mapping: { meters: 'data.windows', fields: { key: 'key', scale: 1 } },
  }
  await assert.rejects(
    () => httpAdapter.read(source, adapterContext(async () => ({ data: {} }))),
    (error) => error.code === 'config',
  )
})

test('http driver surfaces 401 and missing credentials', async () => {
  await assert.rejects(
    () => httpAdapter.read(baseSource, adapterContext(async () => { throw rejected() })),
    (error) => error.code === 'credential-rejected',
  )
  await assert.rejects(
    () => httpAdapter.read(baseSource, adapterContext(async () => ({}), { missing: 'HTTP_KEY' })),
    (error) => error.code === 'missing-credential',
  )
})
