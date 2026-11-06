import test from 'node:test'
import assert from 'node:assert/strict'
import { adapterContext } from './helpers.js'
import * as deepseek from '../lib/adapters/deepseek-balance.js'

const source = { id: 'd', driver: 'deepseek-balance', credential: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.example' }

test('deepseek-balance maps every currency to a value-only meter', async () => {
  const ctx = adapterContext(async () => ({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
      { currency: 'USD', total_balance: '15.50' },
    ],
  }))

  const result = await deepseek.read(source, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.meters.length, 2)
  assert.equal(result.meters[0].key, 'balance-cny')
  assert.equal(result.meters[0].value, 110)
  assert.equal(result.meters[0].unit, 'currency')
  assert.equal(result.meters[0].currency, 'CNY')
  assert.equal(result.meters[0].percent, undefined)
  assert.equal(result.meters[0].primary, true)
  assert.equal(result.meters[1].currency, 'USD')
  assert.equal(result.notice, null)
})

test('deepseek-balance reports insufficient balance and empty data', async () => {
  const low = adapterContext(async () => ({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0' }] }))
  const lowResult = await deepseek.read(source, low)
  assert.equal(lowResult.notice, 'balance-empty')

  const empty = adapterContext(async () => ({ is_available: true, balance_infos: [] }))
  const emptyResult = await deepseek.read(source, empty)
  assert.equal(emptyResult.notice, 'no-data')
  assert.equal(emptyResult.meters.length, 0)
})

test('deepseek-balance surfaces missing credentials', async () => {
  const ctx = adapterContext(async () => ({}), { missing: 'DEEPSEEK_API_KEY' })
  await assert.rejects(() => deepseek.read(source, ctx), (error) => error.code === 'missing-credential')
})
