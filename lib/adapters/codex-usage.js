/**
 * OpenAI Codex 订阅额度适配器。
 *
 * 走 ChatGPT 后端 `GET {baseUrl}/wham/usage`，用本机已有的 Codex 登录凭据：
 *   - DSH 的 `$DSH_HOME/.openai-codex-auth.json`；
 *   - Codex CLI 的 `$CODEX_HOME/auth.json`。
 *
 * 接口只返回两个窗口的已用百分比（5 小时 / 本周），没有按天的 tokens / 成本，
 * 所以 `usage` 为 null。令牌刷新交给 DSH 或 Codex CLI：插件只读，不写回凭据，
 * 避免轮换 refresh token 把宿主自己的登录顶掉。
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { QuotaError, requireCredential } from '../errors.js'
import { buildMeter, finiteNumber, normalizePlan, trimBaseUrl } from '../quota.js'

export const id = 'codex-usage'
export const label = 'OpenAI Codex'
export const labelKey = 'source.codex'
export const defaults = {
  baseUrl: 'https://chatgpt.com/backend-api',
  credential: undefined,
}

/** 提前多久把令牌视为过期，避免请求发出去才 401。 */
const EXPIRY_SKEW_MS = 60 * 1000

/** 已知的 ChatGPT 套餐名；未识别的 plan_type 不强行翻译。 */
const PLAN_LABELS = new Map([
  ['free', 'ChatGPT Free'],
  ['plus', 'ChatGPT Plus'],
  ['pro', 'ChatGPT Pro'],
  ['team', 'ChatGPT Team'],
  ['business', 'ChatGPT Business'],
  ['enterprise', 'ChatGPT Enterprise'],
  ['edu', 'ChatGPT Edu'],
])

/**
 * 默认的登录文件候选路径，按优先级排列。
 * @param {Record<string, string | undefined>} [env] 环境变量。
 * @param {string} [home] 用户主目录。
 * @returns {string[]} 候选文件。
 */
export function codexAuthFiles(env = process.env, home = homedir()) {
  const dshHome = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== ''
    ? env.DSH_HOME
    : join(home, '.dsh')
  const codexHome = typeof env.CODEX_HOME === 'string' && env.CODEX_HOME !== ''
    ? env.CODEX_HOME
    : join(home, '.codex')
  return [join(dshHome, '.openai-codex-auth.json'), join(codexHome, 'auth.json')]
}

/**
 * 展开路径开头的 `~`。
 * @param {string} file 配置里的路径。
 * @param {string} [home] 用户主目录。
 * @returns {string} 可读取的路径。
 */
function expandHome(file, home = homedir()) {
  if (file === '~') return home
  if (file.startsWith('~/')) return join(home, file.slice(2))
  return file
}

/**
 * 把秒或毫秒时间戳统一成毫秒。
 * @param {unknown} value 原始时间戳。
 * @returns {number | undefined} 毫秒时间戳。
 */
function normalizeExpiry(value) {
  const number = finiteNumber(value)
  if (number === undefined || number <= 0) return undefined
  return number < 1e12 ? number * 1000 : number
}

/**
 * 从 JWT 的 exp 推断过期时间。
 * @param {string} token 访问令牌。
 * @returns {number | undefined} 毫秒时间戳。
 */
function jwtExpiry(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return normalizeExpiry(payload?.exp)
  } catch {
    return undefined
  }
}

/**
 * 从 DSH 的凭据文件里取当前账号。
 * @param {Record<string, any>} body 文件内容。
 * @returns {{ access: string, accountId?: string, expires?: number } | undefined} 凭据。
 */
function fromDshAuth(body) {
  const list = Array.isArray(body?.credentials) ? body.credentials : []
  const oauth = list.filter(
    (entry) => entry !== null && typeof entry === 'object'
      && typeof entry.access === 'string' && entry.access !== '',
  )
  if (oauth.length === 0) return undefined
  const activeId = body?.activeAccountId
  const entry = oauth.find((item) => item.accountId === activeId) ?? oauth[0]
  return {
    access: entry.access,
    accountId: typeof entry.accountId === 'string' && entry.accountId !== '' ? entry.accountId : undefined,
    expires: normalizeExpiry(entry.expires) ?? jwtExpiry(entry.access),
  }
}

/**
 * 从 Codex CLI 的 auth.json 里取令牌。
 * @param {Record<string, any>} body 文件内容。
 * @returns {{ access: string, accountId?: string, expires?: number } | undefined} 凭据。
 */
function fromCodexCliAuth(body) {
  const tokens = body?.tokens
  if (tokens === null || typeof tokens !== 'object') return undefined
  if (typeof tokens.access_token !== 'string' || tokens.access_token === '') return undefined
  return {
    access: tokens.access_token,
    accountId: typeof tokens.account_id === 'string' && tokens.account_id !== '' ? tokens.account_id : undefined,
    expires: jwtExpiry(tokens.access_token),
  }
}

/**
 * 解析一份登录文件；不认识的格式返回 undefined。
 * @param {Record<string, any>} body 文件内容。
 * @returns {{ access: string, accountId?: string, expires?: number } | undefined} 凭据。
 */
function parseAuthFile(body) {
  if (body === null || typeof body !== 'object') return undefined
  return fromDshAuth(body) ?? fromCodexCliAuth(body)
}

/**
 * 读到一个可用的访问令牌。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<{ access: string, accountId?: string }>} 令牌与账号。
 */
async function resolveToken(source, ctx) {
  if (typeof source.credential === 'string' && source.credential !== '') {
    const access = requireCredential(await ctx.resolveCredential(source.credential), source.credential)
    return {
      access,
      accountId: typeof source.accountId === 'string' && source.accountId !== '' ? source.accountId : undefined,
    }
  }

  const files = typeof source.authFile === 'string' && source.authFile !== ''
    ? [expandHome(source.authFile)]
    : codexAuthFiles()
  const nowMs = ctx.now instanceof Date ? ctx.now.getTime() : Date.now()
  let expired = false

  for (const file of files) {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }

    let body
    try {
      body = JSON.parse(text)
    } catch {
      continue
    }

    const record = parseAuthFile(body)
    if (record === undefined) continue
    if (record.expires !== undefined && record.expires <= nowMs - EXPIRY_SKEW_MS) {
      expired = true
      continue
    }
    return {
      access: record.access,
      accountId: typeof source.accountId === 'string' && source.accountId !== ''
        ? source.accountId
        : record.accountId,
    }
  }

  if (expired) {
    throw new QuotaError('codex-auth-expired', 'the stored Codex login has expired')
  }
  throw new QuotaError('codex-auth-missing', `no Codex login was found (checked ${files.join(', ')})`)
}

/**
 * 把 Unix 秒 / 相对秒转成 ISO 重置时间。
 * @param {Record<string, any>} window 窗口。
 * @param {Date} now 当前时间。
 * @returns {string | undefined} ISO 时间。
 */
function resetsAtOf(window, now) {
  const resetAt = finiteNumber(window?.reset_at)
  if (resetAt !== undefined && resetAt > 0) {
    return new Date(resetAt * 1000).toISOString()
  }
  const after = finiteNumber(window?.reset_after_seconds)
  if (after !== undefined && after >= 0) {
    return new Date(now.getTime() + after * 1000).toISOString()
  }
  return undefined
}

/**
 * 把一个额度窗口压成 meter。
 * @param {unknown} window 接口里的窗口。
 * @param {'fiveHour' | 'week'} key 窗口位置对应的 meter key。
 * @param {Date} now 当前时间。
 * @returns {Record<string, unknown> | undefined} 归一化 meter。
 */
function windowMeter(window, key, now) {
  if (window === null || typeof window !== 'object') return undefined
  const percent = finiteNumber(window.used_percent)
  if (percent === undefined) return undefined

  const seconds = finiteNumber(window.limit_window_seconds)
  let labelKey = 'meter.windowHours'
  let labelParams
  if (seconds === 18000) {
    labelKey = 'meter.fiveHour'
  } else if (seconds === 604800) {
    labelKey = 'meter.week'
  } else if (seconds !== undefined && seconds > 0) {
    labelParams = { hours: Math.max(1, Math.round(seconds / 3600)) }
  } else {
    labelKey = key === 'week' ? 'meter.week' : 'meter.fiveHour'
  }

  return buildMeter({
    key,
    labelKey,
    labelParams,
    percent,
    unit: 'percent',
    showValue: false,
    resetsAt: resetsAtOf(window, now),
  })
}

/**
 * 把 plan_type 转成展示名。
 * @param {unknown} planType 接口里的套餐类型。
 * @returns {string | undefined} 展示名。
 */
function planLabelOf(planType) {
  if (typeof planType !== 'string' || planType === '') return undefined
  return PLAN_LABELS.get(planType.toLowerCase())
}

/**
 * 读取 Codex 订阅额度。
 * @param {Record<string, any>} source 归一化数据源配置。
 * @param {{ request: Function, resolveCredential: Function, now: Date }} ctx 适配器上下文。
 * @returns {Promise<Record<string, any>>} 源结果。
 */
export async function read(source, ctx) {
  const token = await resolveToken(source, ctx)
  const baseUrl = trimBaseUrl(source.baseUrl ?? defaults.baseUrl)
  const headers = {
    authorization: `Bearer ${token.access}`,
    originator: 'codex_cli_rs',
  }
  if (typeof token.accountId === 'string' && token.accountId !== '') {
    headers['chatgpt-account-id'] = token.accountId
  }

  let body
  try {
    body = await ctx.request(`${baseUrl}/wham/usage`, headers)
  } catch (error) {
    if (error instanceof QuotaError && (error.httpStatus === 401 || error.httpStatus === 403)) {
      throw new QuotaError('codex-auth-expired', 'the Codex login was rejected by the upstream', {
        httpStatus: error.httpStatus,
      })
    }
    throw error
  }

  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const rateLimit = body?.rate_limit
  const meters = [
    windowMeter(rateLimit?.primary_window, 'fiveHour', now),
    windowMeter(rateLimit?.secondary_window, 'week', now),
  ].filter(Boolean)

  return {
    ok: true,
    plan: normalizePlan({ label: planLabelOf(body?.plan_type) }),
    meters,
    usage: null,
    notice: meters.length === 0 ? 'unknown' : meters.length < 2 ? 'partial' : null,
    error: null,
  }
}
