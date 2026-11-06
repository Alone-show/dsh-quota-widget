import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMeter,
  centsToUsd,
  clampPercent,
  localDateKey,
  localDateKeyFromIso,
  localDateKeyFromUnix,
  microCentsToUsd,
  normalizeExternalMeter,
  normalizePlan,
  normalizeUsage,
  percentOf,
} from '../lib/quota.js'

test('percent helpers clamp and handle zero limits', () => {
  assert.equal(clampPercent(-1), 0)
  assert.equal(clampPercent(150), 100)
  assert.equal(percentOf(5, 10), 50)
  assert.equal(percentOf(15, 10), 100)
  assert.equal(percentOf(1, 0), undefined)
  assert.equal(percentOf(undefined, 10), undefined)
})

test('money conversions', () => {
  assert.equal(microCentsToUsd('100000000'), 1)
  assert.equal(microCentsToUsd(undefined), 0)
  assert.equal(centsToUsd('123.45'), 1.2345)
  assert.equal(centsToUsd(undefined), 0)
})

test('buildMeter computes percent, value and units', () => {
  const meter = buildMeter({ key: 'month', used: 5, limit: 20, unit: 'usd', primary: true })
  assert.equal(meter.percent, 25)
  assert.equal(meter.used, 5)
  assert.equal(meter.limit, 20)
  assert.equal(meter.unit, 'usd')
  assert.equal(meter.currency, 'USD')
  assert.equal(meter.primary, true)
  assert.equal(meter.showValue, true)
})

test('buildMeter keeps value-only meters without percent', () => {
  const meter = buildMeter({ key: 'balance', value: 110, unit: 'currency', currency: 'CNY' })
  assert.equal(meter.percent, undefined)
  assert.equal(meter.value, 110)
  assert.equal(meter.currency, 'CNY')
})

test('buildMeter fills value from used when no limit is available', () => {
  const meter = buildMeter({ key: 'cost', used: 3, unit: 'usd' })
  assert.equal(meter.percent, undefined)
  assert.equal(meter.value, 3)
})

test('buildMeter rejects a missing key and normalizes unknown units', () => {
  assert.equal(buildMeter({ key: '' }), undefined)
  const meter = buildMeter({ key: 'x', value: 1, unit: 'charge' })
  assert.equal(meter.unit, 'count')
})

test('normalizeExternalMeter uses fallback keys and showValue', () => {
  const meter = normalizeExternalMeter({ value: 1, showValue: false }, 2)
  assert.equal(meter.key, 'meter-3')
  assert.equal(meter.showValue, false)
})

test('normalizePlan and normalizeUsage return null when empty', () => {
  assert.equal(normalizePlan({}), null)
  assert.equal(normalizeUsage({}), null)
  assert.equal(normalizePlan({ label: 'Go', endsAt: '2026-01-01T00:00:00Z' }).label, 'Go')
  assert.equal(normalizeUsage({ tokens: 10 }).tokens, 10)
})

test('date helpers use local dates', () => {
  const now = new Date(2026, 10, 6, 12, 0, 0)
  assert.equal(localDateKey(now), '2026-11-06')
  assert.equal(localDateKeyFromIso('2026-11-06T04:00:00Z'), localDateKey(new Date('2026-11-06T04:00:00Z')))
  assert.equal(localDateKeyFromUnix(1_900_000_000), localDateKey(new Date(1_900_000_000 * 1000)))
})
