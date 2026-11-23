import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adapterContext, rejected } from './helpers.js'
import * as codex from '../lib/adapters/codex-usage.js'

const now = new Date('2026-11-06T04:00:00Z')

/** 一份典型的 /wham/usage 响应。 */
function usageBody() {
  return {
    user_id: 'user-secret',
    account_id: 'account-secret',
    email: 'person@example.com',
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 25,
        limit_window_seconds: 18000,
        reset_after_seconds: 6522,
        reset_at: 1795412624,
      },
      secondary_window: {
        used_percent: 76,
        limit_window_seconds: 604800,
        reset_after_seconds: 189436,
        reset_at: 1795595538,
      },
    },
    credits: { has_credits: false, balance: '0' },
  }
}

/**
 * 在临时目录写一份登录文件。
 * @param {import('node:test').TestContext} t 测试上下文。
 * @param {string} name 文件名。
 * @param {unknown} body JSON 内容。
 * @returns {Promise<string>} 文件路径。
 */
async function authFile(t, name, body) {
  const dir = await mkdtemp(join(tmpdir(), 'quota-codex-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, name)
  await writeFile(file, JSON.stringify(body))
  return file
}

/**
 * DSH 格式的凭据文件。
 * @param {Partial<Record<string, any>>} [overrides] 覆盖字段。
 * @returns {Record<string, any>} 文件内容。
 */
function dshAuth(overrides = {}) {
  return {
    version: 2,
    activeAccountId: 'acct-1',
    credentials: [
      {
        type: 'oauth',
        access: 'dsh-token',
        refresh: 'refresh-token',
        expires: Date.parse('2026-11-27T04:00:00Z'),
        accountId: 'acct-1',
      },
    ],
    ...overrides,
  }
}

test('codexAuthFiles honors DSH_HOME and CODEX_HOME', () => {
  assert.deepEqual(codex.codexAuthFiles({ DSH_HOME: '/dsh', CODEX_HOME: '/codex' }, '/home/u'), [
    '/dsh/.openai-codex-auth.json',
    '/codex/auth.json',
  ])
  assert.deepEqual(codex.codexAuthFiles({}, '/home/u'), [
    '/home/u/.dsh/.openai-codex-auth.json',
    '/home/u/.codex/auth.json',
  ])
})

test('codex-usage maps both subscription windows from a DSH auth file', async (t) => {
  const file = await authFile(t, '.openai-codex-auth.json', dshAuth())
  let requested
  const ctx = adapterContext(async (url, headers) => {
    requested = { url, headers }
    return usageBody()
  }, { now })

  const result = await codex.read({ id: 'c', driver: 'codex-usage', authFile: file }, ctx)
  assert.equal(requested.url, 'https://chatgpt.com/backend-api/wham/usage')
  assert.equal(requested.headers.authorization, 'Bearer dsh-token')
  assert.equal(requested.headers['chatgpt-account-id'], 'acct-1')
  assert.equal(requested.headers.originator, 'codex_cli_rs')

  assert.equal(result.ok, true)
  assert.equal(result.plan.label, 'ChatGPT Plus')
  assert.equal(result.usage, null)
  assert.equal(result.notice, null)
  assert.equal(result.meters.length, 2)

  const fiveHour = result.meters.find((meter) => meter.key === 'fiveHour')
  assert.equal(fiveHour.labelKey, 'meter.fiveHour')
  assert.equal(fiveHour.unit, 'percent')
  assert.equal(fiveHour.showValue, false)
  assert.equal(fiveHour.percent, 25)
  assert.equal(fiveHour.resetsAt, new Date(1795412624 * 1000).toISOString())

  const week = result.meters.find((meter) => meter.key === 'week')
  assert.equal(week.labelKey, 'meter.week')
  assert.equal(week.percent, 76)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('person@example.com'), false)
  assert.equal(serialized.includes('account-secret'), false)
  assert.equal(serialized.includes('user-secret'), false)
})

test('codex-usage reads a Codex CLI auth.json', async (t) => {
  const file = await authFile(t, 'auth.json', {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: 'id',
      access_token: 'cli-token',
      refresh_token: 'refresh',
      account_id: 'acct-cli',
    },
  })
  let requested
  const ctx = adapterContext(async (url, headers) => {
    requested = { url, headers }
    return usageBody()
  }, { now })

  const result = await codex.read({ id: 'c', driver: 'codex-usage', authFile: file }, ctx)
  assert.equal(requested.headers.authorization, 'Bearer cli-token')
  assert.equal(requested.headers['chatgpt-account-id'], 'acct-cli')
  assert.equal(result.meters.length, 2)
})

test('codex-usage follows activeAccountId when the auth file has several accounts', async (t) => {
  const file = await authFile(t, '.openai-codex-auth.json', dshAuth({
    activeAccountId: 'acct-2',
    credentials: [
      { type: 'oauth', access: 'first-token', accountId: 'acct-1', expires: Date.parse('2026-11-27T04:00:00Z') },
      { type: 'oauth', access: 'second-token', accountId: 'acct-2', expires: Date.parse('2026-11-27T04:00:00Z') },
    ],
  }))
  let requested
  const ctx = adapterContext(async (url, headers) => {
    requested = { url, headers }
    return usageBody()
  }, { now })

  await codex.read({ id: 'c', driver: 'codex-usage', authFile: file }, ctx)
  assert.equal(requested.headers.authorization, 'Bearer second-token')
  assert.equal(requested.headers['chatgpt-account-id'], 'acct-2')
})

test('codex-usage accepts an explicit credential and account id', async () => {
  let requested
  const ctx = adapterContext(async (url, headers) => {
    requested = { url, headers }
    return usageBody()
  }, { now })

  await codex.read({
    id: 'c',
    driver: 'codex-usage',
    credential: 'CODEX_TOKEN',
    accountId: 'acct-config',
  }, ctx)
  assert.equal(requested.headers.authorization, 'Bearer value-CODEX_TOKEN')
  assert.equal(requested.headers['chatgpt-account-id'], 'acct-config')
})

test('codex-usage reports a missing login file', async (t) => {
  const file = await authFile(t, 'missing.json', {})
  const ctx = adapterContext(async () => usageBody(), { now })

  await assert.rejects(
    () => codex.read({ id: 'c', driver: 'codex-usage', authFile: `${file}.nope` }, ctx),
    (error) => error.code === 'codex-auth-missing',
  )
})

test('codex-usage reports an expired login without calling upstream', async (t) => {
  const file = await authFile(t, '.openai-codex-auth.json', dshAuth({
    credentials: [
      { type: 'oauth', access: 'old-token', accountId: 'acct-1', expires: Date.parse('2026-11-01T00:00:00Z') },
    ],
  }))
  let called = false
  const ctx = adapterContext(async () => {
    called = true
    return usageBody()
  }, { now })

  await assert.rejects(
    () => codex.read({ id: 'c', driver: 'codex-usage', authFile: file }, ctx),
    (error) => error.code === 'codex-auth-expired',
  )
  assert.equal(called, false)
})

test('codex-usage maps upstream 401 to an expired login', async () => {
  let requested
  const ctx = adapterContext(async () => {
    requested = true
    throw rejected()
  }, { now })

  await assert.rejects(
    () => codex.read({ id: 'c', driver: 'codex-usage', credential: 'CODEX_TOKEN' }, ctx),
    (error) => error.code === 'codex-auth-expired' && error.httpStatus === 401,
  )
  assert.equal(requested, true)
})

test('codex-usage reports partial and unknown windows', async () => {
  const ctxOne = adapterContext(async () => ({
    plan_type: 'pro',
    rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } },
  }), { now })
  const partial = await codex.read({ id: 'c', driver: 'codex-usage', credential: 'CODEX_TOKEN' }, ctxOne)
  assert.equal(partial.meters.length, 1)
  assert.equal(partial.notice, 'partial')
  assert.equal(partial.plan.label, 'ChatGPT Pro')

  const ctxNone = adapterContext(async () => ({ plan_type: 'plus', rate_limit: null }), { now })
  const unknown = await codex.read({ id: 'c', driver: 'codex-usage', credential: 'CODEX_TOKEN' }, ctxNone)
  assert.equal(unknown.meters.length, 0)
  assert.equal(unknown.notice, 'unknown')
})
