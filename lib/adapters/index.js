/**
 * 内置数据源适配器注册表。
 */

import * as opencodeGo from './opencode-go.js'
import * as deepseekBalance from './deepseek-balance.js'
import * as anthropicUsage from './anthropic-usage.js'
import * as openaiUsage from './openai-usage.js'
import * as http from './http.js'

/** driver id → 适配器模块。 */
export const DRIVERS = {
  'opencode-go': opencodeGo,
  'deepseek-balance': deepseekBalance,
  'anthropic-usage': anthropicUsage,
  'openai-usage': openaiUsage,
  http,
}

/** 配置 schema 里允许的 driver id。 */
export const DRIVER_IDS = Object.keys(DRIVERS)
