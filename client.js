/**
 * 额度浮窗 —— 浏览器半侧（手写 __ModuleLoader__ 包，不经构建）。
 *
 * 在 shell.overlay（框架级浮动层）里挂一个右下角小胶囊：平时只显示配置指定的
 * 那个数据源的关键额度，点一下展开成小弹窗，按源分组显示全部 meters、重置倒计时
 * 和今日用量。
 *
 * 数据来自宿主半侧的同源只读路由 `/plugins/quota-widget`（浏览器直接请求上游
 * 会被 CORS 挡掉，且 API Key 不能下发到页面）。
 *
 * 另外向插件页注册 `plugins.bundle.config`：在「插件 → 已安装插件 →
 * dsh-quota-widget」里直接编辑 sources / display / cache，保存走 settings 的
 * volatile 写入，宿主热更新后浮窗立即刷新。没有 settings 的部署只挂浮窗。
 *
 * 样式只用宿主主题令牌（--dsw-alias-*），深浅色自动跟随；文案走 ctx.locale。
 */

window.__ModuleLoader__.load({
  id: 'dsh-quota-widget',
  factory: (require) => {
    // 装载器调用 factory 时不注入 module/exports，CJS 包装要自己建（同 dsh-quick-keys）。
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

    /** 本插件的 locale 命名空间。 */
    const NS = 'quota-widget';
    /** 与宿主 index.js 里的 ROUTE_PATH 保持一致。 */
    const ENDPOINT = '/plugins/quota-widget';
    /** npm 包名：插件页配置区以它作为 bundle key。 */
    const BUNDLE_NAME = 'dsh-quota-widget';
    /** profile 补丁层里的行 id：settings 表单的命名空间。 */
    const ENTRY_ID = 'quota-widget';
    /** 保存成功后通知浮窗立即刷新的事件名。 */
    const REFRESH_EVENT = 'quota-widget:refresh';
    /** 默认轮询间隔；宿主响应里的 display.pollMs 可以覆盖。 */
    const DEFAULT_POLL_MS = 20000;
    /** 浮窗不透明度存在浏览器里的 key。 */
    const OPACITY_KEY = 'dsh-quota-widget:opacity';
    /** 不透明度下限：太淡就看不见、也滚不回来了。 */
    const OPACITY_MIN = 0.25;
    /** 不透明度上限，也是默认值。 */
    const OPACITY_MAX = 1;
    /** 滚轮一档的步进。 */
    const OPACITY_STEP = 0.05;
    /** 连续滚动时两次调整的最小间隔，避免触控板一滑到底。 */
    const WHEEL_THROTTLE_MS = 80;
    /** 调完透明度后提示条停留多久。 */
    const OPACITY_HUD_MS = 1200;

    const zh = {
      'pill.label': '额度',
      'panel.title': '额度',
      'panel.sources': '{n} 个数据源',
      'panel.sourcesOne': '{n} 个数据源',
      'plan.endsAt': '{date} 到期',
      'plan.expired': '已过期',
      'plan.cancelAtPeriodEnd': '本期结束后停止',
      'source.opencode-go': 'OpenCode Go',
      'source.deepseek': 'DeepSeek',
      'source.anthropic': 'Anthropic',
      'source.openai': 'OpenAI',
      'source.http': '自定义接口',
      'meter.fiveHour': '5 小时',
      'meter.week': '本周',
      'meter.month': '本月',
      'meter.monthCost': '本月花费',
      'meter.balance': '{currency} 余额',
      'meter.resetIn': '{time}后重置',
      'meter.resetUnknown': '重置时间未知',
      'unit.tokens': '{tokens} tokens',
      'unit.requests': '{requests} 次请求',
      'usage.today': '今日',
      'state.loading': '读取中…',
      'state.missing': '未配置 {ref}',
      'state.apiKey': 'API Key',
      'state.rejected': 'API Key 被拒绝，可能已过期',
      'state.adminKey': '该数据源需要 Admin API Key，普通 API Key 无法读取组织用量',
      'state.failed': '额度读取失败',
      'state.config': '额度映射配置有误',
      'state.noData': '暂无额度数据',
      'state.noSources': '没有启用的额度数据源',
      'state.retry': '重试',
      'notice.nonGo': '当前账号不是 OpenCode Go 订阅',
      'notice.nonGoDetail': 'Go 订阅才有 5 小时 / 本周 / 本月额度；下面只是今日按量用量。',
      'notice.unknown': '读不到套餐信息，额度暂不可用。',
      'notice.unknownDetail': '上游额度接口请求失败，稍后重试或检查网络。',
      'notice.balanceEmpty': '余额不足，API 调用可能失败。',
      'notice.balanceEmptyDetail': '请及时充值，避免请求被上游拒绝。',
      'notice.noData': '上游没有返回额度数据。',
      'notice.noDataDetail': '检查接口权限或返回结构是否与配置匹配。',
      'notice.partial': '部分数据读取失败。',
      'notice.partialDetail': '当前显示的是成功读取的那部分；点刷新可重试。',
      'updated': '{time} 更新',
      'action.refresh': '刷新',
      'action.expand': '展开额度浮窗',
      'action.collapse': '收起额度浮窗',
      'time.soon': '即将',
      'time.days': '{d} 天 {h} 小时',
      'time.hours': '{h} 小时 {m} 分',
      'time.minutes': '{m} 分钟',
      'opacity.hint': '透明度 {percent}%',
      'opacity.reset': '恢复默认透明度（100%）',
      'opacity.wheel': '滚轮调整透明度',
      'action.configure': '配置额度浮窗',
      'config.title': '配置',
      'config.description': '修改会写入当前 profile 的补丁层，保存后浮窗立即刷新，不需要重启。',
      'config.loading': '正在读取配置…',
      'config.unavailable': '这个部署没有可用的设置服务，无法在面板里编辑；请继续编辑 profile 的 cordis.patch.yml。',
      'config.readOnly': '当前 profile 不允许表单写入，只能查看。',
      'config.section.display': '显示',
      'config.section.sources': '数据源',
      'config.section.cache': '缓存与超时',
      'config.display.title': '标题',
      'config.display.titleHint': '留空用默认标题。',
      'config.display.placement': '浮窗位置',
      'config.display.bottomRight': '右下角',
      'config.display.bottomLeft': '左下角',
      'config.display.pollMs': '轮询间隔（毫秒）',
      'config.display.pollMsHint': '最低 5000。',
      'config.display.showUsage': '显示今日用量',
      'config.display.pillSource': '收起胶囊的数据源',
      'config.display.pillSourceHint': '留空自动选择第一个可用源。',
      'config.display.pillMeter': '收起胶囊的 meter',
      'config.display.pillMeterHint': '留空按主 meter / 百分比最高选择。',
      'config.source.enabled': '启用',
      'config.source.id': '源 ID',
      'config.source.idHint': '小写字母、数字和连字符，例如 opencode-go。',
      'config.source.driver': '驱动',
      'config.source.label': '展示名',
      'config.source.labelHint': '留空用驱动默认名。',
      'config.source.credential': '凭据引用',
      'config.source.credentialHint': '只填凭据名，不填密钥；留空用默认引用 {ref}。',
      'config.source.baseUrl': '接口根地址',
      'config.source.baseUrlHint': '留空用默认地址。',
      'config.source.apiVersion': 'API 版本',
      'config.source.organization': '组织 ID',
      'config.source.scale': '数值倍率',
      'config.source.budget': '月度预算',
      'config.source.budgetAmount': '金额',
      'config.source.budgetCurrency': '币种（USD）',
      'config.source.url': '接口 URL',
      'config.source.authType': '鉴权方式',
      'config.source.authBearer': 'Bearer',
      'config.source.authHeaderMode': '自定义请求头',
      'config.source.authNone': '无鉴权',
      'config.source.authHeader': '自定义鉴权头',
      'config.source.authPrefix': '前缀',
      'config.source.headers': '请求头（JSON）',
      'config.source.query': '查询参数（JSON）',
      'config.source.mapping': '额度映射（JSON）',
      'config.source.mappingHint': '留空表示上游直接返回标准契约；填写时必须含 meters。',
      'config.source.advanced': '高级 HTTP 选项',
      'config.source.add': '添加数据源',
      'config.source.remove': '删除',
      'config.source.empty': '还没有数据源；添加一个后保存。',
      'config.cache.ttlMs': '成功缓存（毫秒）',
      'config.cache.errorTtlMs': '失败缓存（毫秒）',
      'config.cache.timeoutMs': '请求超时（毫秒）',
      'config.save': '保存',
      'config.saving': '正在保存…',
      'config.discard': '放弃修改',
      'config.saved': '已保存，浮窗会立即刷新。',
      'config.conflict': '配置已在别处被修改。请重新载入后再编辑。',
      'config.reload': '重新载入',
      'config.auto': '自动',
      'config.error.sources': '数据源必须是列表。',
      'config.error.placement': '位置只能是 bottom-right 或 bottom-left。',
      'config.error.id': '源 ID 必须匹配 ^[a-z0-9][a-z0-9-]*$。',
      'config.error.duplicateId': '源 ID 重复。',
      'config.error.driver': '未知的驱动。',
      'config.error.credential': '凭据引用必须是 POSIX shell 标识符。',
      'config.error.urlRequired': '通用 HTTP 源必须填写 URL。',
      'config.error.urlInvalid': 'URL 必须使用 http 或 https。',
      'config.error.headerRequired': '鉴权头不能为空。',
      'config.error.json': 'JSON 格式不正确（需要 JSON 对象）。',
      'config.error.meters': 'mapping 必须包含 meters。',
      'config.error.budgetDriver': '只有 Anthropic / OpenAI 成本型源支持预算。',
      'config.error.budgetAmount': '预算金额必须大于 0。',
      'config.error.budgetCurrency': '预算币种必须是 USD。',
      'config.error.min': '不能小于 {min}。',
      'config.error.number': '请填写数字。',
      'config.error.pillSource': '引用的源不存在。',
      'config.error.scale': '倍率必须是数字。',
    };

    const en = {
      'pill.label': 'Quota',
      'panel.title': 'Quota',
      'panel.sources': '{n} sources',
      'panel.sourcesOne': '{n} source',
      'plan.endsAt': 'ends {date}',
      'plan.expired': 'Expired',
      'plan.cancelAtPeriodEnd': 'ends after this period',
      'source.opencode-go': 'OpenCode Go',
      'source.deepseek': 'DeepSeek',
      'source.anthropic': 'Anthropic',
      'source.openai': 'OpenAI',
      'source.http': 'Custom endpoint',
      'meter.fiveHour': '5 hours',
      'meter.week': 'This week',
      'meter.month': 'This month',
      'meter.monthCost': "This month's cost",
      'meter.balance': '{currency} balance',
      'meter.resetIn': 'resets in {time}',
      'meter.resetUnknown': 'reset time unknown',
      'unit.tokens': '{tokens} tokens',
      'unit.requests': '{requests} requests',
      'usage.today': 'Today',
      'state.loading': 'Loading…',
      'state.missing': '{ref} is not configured',
      'state.apiKey': 'API key',
      'state.rejected': 'API key rejected, it may have expired',
      'state.adminKey': 'This source needs an Admin API key; a regular API key cannot read organization usage',
      'state.failed': 'Could not read quota',
      'state.config': 'The quota mapping is misconfigured',
      'state.noData': 'No quota data',
      'state.noSources': 'No quota sources are enabled',
      'state.retry': 'Retry',
      'notice.nonGo': 'This account is not on an OpenCode Go plan',
      'notice.nonGoDetail': 'Only Go subscriptions carry 5-hour / weekly / monthly quota; below is today’s metered usage.',
      'notice.unknown': 'Could not read the plan state; quota is unavailable.',
      'notice.unknownDetail': 'The upstream quota API failed. Retry later or check the network.',
      'notice.balanceEmpty': 'The balance is insufficient; API calls may fail.',
      'notice.balanceEmptyDetail': 'Top up to avoid upstream rejections.',
      'notice.noData': 'The upstream returned no quota data.',
      'notice.noDataDetail': 'Check the endpoint permission or whether the response matches the mapping.',
      'notice.partial': 'Some data could not be read.',
      'notice.partialDetail': 'Showing the part that succeeded; press refresh to retry.',
      'updated': 'updated {time}',
      'action.refresh': 'Refresh',
      'action.expand': 'Expand quota widget',
      'action.collapse': 'Collapse quota widget',
      'time.soon': 'moments',
      'time.days': '{d}d {h}h',
      'time.hours': '{h}h {m}m',
      'time.minutes': '{m}m',
      'opacity.hint': 'Opacity {percent}%',
      'opacity.reset': 'Reset opacity (100%)',
      'opacity.wheel': 'Scroll to adjust opacity',
      'action.configure': 'Configure quota widget',
      'config.title': 'Configuration',
      'config.description': 'Saving writes the current profile’s patch layer and refreshes the widget immediately; no restart needed.',
      'config.loading': 'Reading configuration…',
      'config.unavailable': 'This deployment has no settings service, so the form is unavailable. Keep editing the profile’s cordis.patch.yml.',
      'config.readOnly': 'This profile does not accept form writes; the values are read-only.',
      'config.section.display': 'Display',
      'config.section.sources': 'Sources',
      'config.section.cache': 'Cache and timeouts',
      'config.display.title': 'Title',
      'config.display.titleHint': 'Leave empty for the default title.',
      'config.display.placement': 'Widget position',
      'config.display.bottomRight': 'Bottom right',
      'config.display.bottomLeft': 'Bottom left',
      'config.display.pollMs': 'Poll interval (ms)',
      'config.display.pollMsHint': 'Minimum 5000.',
      'config.display.showUsage': 'Show today’s usage',
      'config.display.pillSource': 'Pill source',
      'config.display.pillSourceHint': 'Empty picks the first available source.',
      'config.display.pillMeter': 'Pill meter',
      'config.display.pillMeterHint': 'Empty picks the primary or highest-percentage meter.',
      'config.source.enabled': 'Enabled',
      'config.source.id': 'Source ID',
      'config.source.idHint': 'Lowercase letters, digits and dashes, such as opencode-go.',
      'config.source.driver': 'Driver',
      'config.source.label': 'Display name',
      'config.source.labelHint': 'Empty uses the driver’s default name.',
      'config.source.credential': 'Credential reference',
      'config.source.credentialHint': 'A reference name, never the secret; empty uses {ref}.',
      'config.source.baseUrl': 'Base URL',
      'config.source.baseUrlHint': 'Empty uses the default endpoint.',
      'config.source.apiVersion': 'API version',
      'config.source.organization': 'Organization ID',
      'config.source.scale': 'Value scale',
      'config.source.budget': 'Monthly budget',
      'config.source.budgetAmount': 'Amount',
      'config.source.budgetCurrency': 'Currency (USD)',
      'config.source.url': 'Endpoint URL',
      'config.source.authType': 'Authentication',
      'config.source.authBearer': 'Bearer',
      'config.source.authHeaderMode': 'Custom header',
      'config.source.authNone': 'No authentication',
      'config.source.authHeader': 'Custom auth header',
      'config.source.authPrefix': 'Prefix',
      'config.source.headers': 'Headers (JSON)',
      'config.source.query': 'Query parameters (JSON)',
      'config.source.mapping': 'Quota mapping (JSON)',
      'config.source.mappingHint': 'Empty means the upstream already returns the standard contract; otherwise meters is required.',
      'config.source.advanced': 'Advanced HTTP options',
      'config.source.add': 'Add source',
      'config.source.remove': 'Remove',
      'config.source.empty': 'No sources yet; add one and save.',
      'config.cache.ttlMs': 'Success cache (ms)',
      'config.cache.errorTtlMs': 'Failure cache (ms)',
      'config.cache.timeoutMs': 'Request timeout (ms)',
      'config.save': 'Save',
      'config.saving': 'Saving…',
      'config.discard': 'Discard changes',
      'config.saved': 'Saved; the widget is refreshing now.',
      'config.conflict': 'The configuration changed elsewhere. Reload before editing.',
      'config.reload': 'Reload',
      'config.auto': 'Auto',
      'config.error.sources': 'Sources must be a list.',
      'config.error.placement': 'The position must be bottom-right or bottom-left.',
      'config.error.id': 'Source ID must match ^[a-z0-9][a-z0-9-]*$.',
      'config.error.duplicateId': 'Duplicate source ID.',
      'config.error.driver': 'Unknown driver.',
      'config.error.credential': 'Credential references must be POSIX shell identifiers.',
      'config.error.urlRequired': 'A generic HTTP source needs a URL.',
      'config.error.urlInvalid': 'The URL must use http or https.',
      'config.error.headerRequired': 'The custom auth header cannot be empty.',
      'config.error.json': 'Invalid JSON (a JSON object is required).',
      'config.error.meters': 'mapping must contain meters.',
      'config.error.budgetDriver': 'Only Anthropic / OpenAI cost sources support a budget.',
      'config.error.budgetAmount': 'The budget amount must be greater than 0.',
      'config.error.budgetCurrency': 'The budget currency must be USD.',
      'config.error.min': 'Must be at least {min}.',
      'config.error.number': 'Enter a number.',
      'config.error.pillSource': 'That source does not exist.',
      'config.error.scale': 'The scale must be a number.',
    };

    /** 组件内样式：随组件挂载/卸载，不写 document。 */
    const CSS = `
.qw-root{position:fixed;right:20px;bottom:20px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary)}
.qw-root[data-placement="bottom-left"]{left:20px;right:auto;align-items:flex-start}
.qw-root *{box-sizing:border-box}
.qw-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;font:inherit;font-size:12px;font-weight:500;transition:border-color .15s ease,background .15s ease,opacity .1s linear}
.qw-pill:hover{border-color:var(--dsw-alias-border-l2)}
.qw-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.qw-dot{width:7px;height:7px;border-radius:50%;background:var(--qw-tone);flex:0 0 auto}
.qw-panel{pointer-events:auto;width:320px;max-width:calc(100vw - 40px);max-height:min(70vh,560px);overflow-y:auto;overscroll-behavior:contain;padding:14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 48px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);transition:opacity .1s linear;scrollbar-width:thin}
.qw-hud{position:absolute;right:0;bottom:calc(100% + 6px);display:flex;justify-content:flex-end;pointer-events:none;visibility:hidden;opacity:0;transform:translateY(3px);transition:opacity .15s ease,transform .15s ease,visibility .15s ease}
.qw-root[data-placement="bottom-left"] .qw-hud{left:0;right:auto;justify-content:flex-start}
.qw-hud-on{visibility:visible;opacity:1;transform:none}
.qw-hud-chip{pointer-events:none;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;font-variant-numeric:tabular-nums;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.qw-hud-on .qw-hud-chip{pointer-events:auto}
.qw-hud-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.qw-hud-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.qw-head-main{display:flex;align-items:center;gap:7px;min-width:0}
.qw-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}
.qw-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.qw-icon{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
.qw-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.qw-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qw-icon.qw-spin{animation:qw-rotate .9s linear infinite}
@keyframes qw-rotate{to{transform:rotate(360deg)}}
.qw-sources{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.qw-source{display:flex;flex-direction:column;gap:7px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.qw-source:first-child{padding-top:0;border-top:none}
.qw-source-head{display:flex;align-items:baseline;gap:6px;min-width:0}
.qw-source-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.qw-plan{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap}
.qw-meters{display:flex;flex-direction:column;gap:10px}
.qw-meter-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.qw-meter-name{font-size:12px;font-weight:500}
.qw-meter-value{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.qw-bar{position:relative;margin-top:5px;height:6px;border-radius:999px;overflow:hidden;background:linear-gradient(90deg,var(--dsw-alias-state-success-primary) 0%,var(--dsw-alias-state-success-primary) 45%,var(--dsw-alias-state-warn-primary) 75%,var(--dsw-alias-state-error-primary) 100%)}
.qw-bar-cover{position:absolute;top:0;bottom:0;right:0;background:var(--dsw-alias-bg-layer-2);transition:left .3s ease}
.qw-meter-sub{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.qw-usage{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.qw-notice,.qw-error{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qw-notice-detail,.qw-error-detail{opacity:.75}
.qw-error{color:var(--dsw-alias-state-error-primary)}
.qw-error-detail{color:var(--dsw-alias-label-secondary)}
.qw-state{display:flex;flex-direction:column;gap:8px;margin-top:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.qw-btn{align-self:flex-start;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}
.qw-btn:hover{border-color:var(--dsw-alias-border-l2)}
.qw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qw-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:13px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
.qw-foot-actions{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.qw-head-actions{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}
.qwcfg{display:flex;flex-direction:column;gap:14px;font-size:12px;color:var(--dsw-alias-label-primary)}
.qwcfg *{box-sizing:border-box}
.qwcfg-head{display:flex;flex-direction:column;gap:2px}
.qwcfg-title{font-size:13px;font-weight:600;margin:0}
.qwcfg-desc,.qwcfg-hint,.qwcfg-error,.qwcfg-status{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qwcfg-error,.qwcfg-status-error{color:var(--dsw-alias-state-error-primary)}
.qwcfg-status-ok{color:var(--dsw-alias-state-success-primary)}
.qwcfg-section{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.qwcfg-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.qwcfg-section-title{font-size:12px;font-weight:600;margin:0}
.qwcfg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.qwcfg-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.qwcfg-label{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.qwcfg-input,.qwcfg-select,.qwcfg-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 7px;min-height:28px}
.qwcfg-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.45}
.qwcfg-input:focus-visible,.qwcfg-select:focus-visible,.qwcfg-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qwcfg-input[aria-invalid="true"],.qwcfg-select[aria-invalid="true"],.qwcfg-textarea[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.qwcfg-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}
.qwcfg-source{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-overlay)}
.qwcfg-source-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.qwcfg-source-name{font-size:12px;font-weight:600}
.qwcfg-subgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.qwcfg-advanced{display:flex;flex-direction:column;gap:10px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l1)}
.qwcfg-advanced summary{font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.qwcfg-footer{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 2px;background:var(--dsw-alias-bg-overlay)}
.qwcfg-spacer{flex:1 1 auto}
.qwcfg-btn{height:28px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.qwcfg-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.qwcfg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.qwcfg-btn:disabled{opacity:.55;cursor:not-allowed}
.qwcfg-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand,#fff)}
.qwcfg-btn-ghost{background:transparent}
.qwcfg-btn-danger{color:var(--dsw-alias-state-error-primary)}
.qwcfg-notice{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);font-size:11px;color:var(--dsw-alias-label-secondary)}
.qwcfg-notice-actions,.qwcfg-actions{display:flex;gap:8px}
`;

    /**
     * 百分比：小于 10% 保留一位小数，其余取整。
     * @param {number} value 0–100。
     * @returns {string} `17.6%` 形式。
     */
    function formatPercent(value) {
      const n = Number.isFinite(value) ? Math.max(0, value) : 0;
      return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
    }

    /**
     * 把百分比夹到 0–100。
     * @param {number} value 任意值。
     * @returns {number} 0–100。
     */
    function clampPercent(value) {
      if (!Number.isFinite(value)) return 0;
      return Math.min(100, Math.max(0, value));
    }

    /**
     * 把不透明度夹到 [OPACITY_MIN, OPACITY_MAX]，并按步进取两位小数。
     * @param {number} value 任意数值。
     * @returns {number} 合法的 0.25–1 之间的值。
     */
    function clampOpacity(value) {
      const n = Number.isFinite(value) ? value : OPACITY_MAX;
      return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(n * 100) / 100));
    }

    /**
     * 读上次记住的不透明度；没有存过、解析失败、隐私模式下都回默认值。
     * @returns {number} 合法的 0.25–1 之间的值。
     */
    function readStoredOpacity() {
      try {
        const raw = window.localStorage.getItem(OPACITY_KEY);
        if (raw === null || raw === '') return OPACITY_MAX;
        const value = Number(raw);
        return Number.isFinite(value) ? clampOpacity(value) : OPACITY_MAX;
      } catch {
        return OPACITY_MAX;
      }
    }

    /**
     * 记住不透明度；写失败（隐私模式 / 配额满）只影响记忆，不影响当前会话。
     * @param {number} value 合法的 0.25–1 之间的值。
     */
    function persistOpacity(value) {
      try {
        window.localStorage.setItem(OPACITY_KEY, String(value));
      } catch {
        /* 记忆失败时静默降级 */
      }
    }

    /**
     * 紧凑数字（token / 请求数）：走 Intl，中文出“1.7亿”，英文出“169M”。
     * @param {number} value 数值。
     * @param {string} localeId 当前 locale。
     * @returns {string} 紧凑文本。
     */
    function compactNumber(value, localeId) {
      const n = Number.isFinite(value) ? value : 0;
      try {
        return new Intl.NumberFormat(localeId, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
      } catch {
        return String(n);
      }
    }

    /**
     * 金额格式化。
     * @param {number} value 金额。
     * @param {string} currency 币种。
     * @param {string} localeId 当前 locale。
     * @returns {string} 金额文本。
     */
    function formatCurrency(value, currency, localeId) {
      const n = Number.isFinite(value) ? value : 0;
      const code = typeof currency === 'string' && currency !== '' ? currency.toUpperCase() : 'USD';
      try {
        return new Intl.NumberFormat(localeId, {
          style: 'currency',
          currency: code,
          maximumFractionDigits: 2,
        }).format(n);
      } catch {
        return `${code} ${n.toFixed(2)}`;
      }
    }

    /**
     * 剩余时长文案。
     * @param {number} ms 剩余毫秒。
     * @param {(key: string, params?: Record<string, unknown>) => string} t 翻译函数。
     * @returns {string} 例如“3 天 4 小时”。
     */
    function durationText(ms, t) {
      if (!Number.isFinite(ms)) return '';
      if (ms <= 0) return t('time.soon');
      const totalMinutes = Math.ceil(ms / 60000);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) return t('time.days', { d: days, h: hours });
      if (hours > 0) return t('time.hours', { h: hours, m: minutes });
      return t('time.minutes', { m: Math.max(1, minutes) });
    }

    /**
     * 按用量挑配色令牌：<70% 品牌色，<90% 警告色，其余错误色。
     * @param {number} percent 0–100。
     * @returns {string} CSS 颜色表达式。
     */
    function toneOf(percent) {
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)';
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-brand-primary)';
    }

    /**
     * 本地 HH:MM:SS。
     * @param {string} iso ISO 时间串。
     * @param {string} localeId 当前 locale。
     * @returns {string} 时间文本。
     */
    function clock(iso, localeId) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      try {
        return date.toLocaleTimeString(localeId, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch {
        return date.toLocaleTimeString();
      }
    }

    /**
     * 本地 M月D日 / M-D。
     * @param {string} iso ISO 时间串。
     * @param {string} localeId 当前 locale。
     * @returns {string} 日期文本。
     */
    function shortDate(iso, localeId) {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      try {
        return date.toLocaleDateString(localeId, { month: 'short', day: 'numeric' });
      } catch {
        return `${date.getMonth() + 1}-${date.getDate()}`;
      }
    }

    /**
     * 取展示标签：labelKey 优先，缺失或翻译未命中时退回 label / key。
     * @param {{ label?: string, labelKey?: string, labelParams?: Record<string, unknown>, key?: string }} item 带标签的条目。
     * @param {(key: string, params?: Record<string, unknown>) => string} t 翻译函数。
     * @returns {string} 展示文本。
     */
    function labelOf(item, t) {
      if (item !== null && item !== undefined && typeof item.labelKey === 'string' && item.labelKey !== '') {
        const text = t(item.labelKey, item.labelParams ?? {});
        if (text !== item.labelKey) return text;
      }
      if (item !== null && item !== undefined && typeof item.label === 'string' && item.label !== '') return item.label;
      if (item !== null && item !== undefined && typeof item.key === 'string' && item.key !== '') return item.key;
      return '';
    }

    /**
     * 数据源展示名。
     * @param {Record<string, any>} source 源。
     * @param {Function} t 翻译函数。
     * @returns {string} 展示名。
     */
    function sourceLabel(source, t) {
      const label = labelOf({ key: source.id, label: source.label, labelKey: source.labelKey }, t);
      return label !== '' ? label : source.id;
    }

    /**
     * meter 数值文本。
     * @param {Record<string, any>} meter meter。
     * @param {string} localeId 当前 locale。
     * @param {Function} t 翻译函数。
     * @returns {string} 数值文本。
     */
    function formatMeterValue(meter, localeId, t) {
      const value = Number.isFinite(meter.value)
        ? meter.value
        : Number.isFinite(meter.used)
          ? meter.used
          : 0;
      switch (meter.unit) {
        case 'usd':
          return formatCurrency(value, 'USD', localeId);
        case 'currency':
          return formatCurrency(value, meter.currency, localeId);
        case 'percent':
          return formatPercent(value);
        case 'tokens':
          return t('unit.tokens', { tokens: compactNumber(value, localeId) });
        case 'requests':
          return t('unit.requests', { requests: compactNumber(value, localeId) });
        default:
          return compactNumber(value, localeId);
      }
    }

    /**
     * meter 右上角文本：有百分比就显示百分比，否则显示金额/数值。
     * @param {Record<string, any>} meter meter。
     * @param {string} localeId 当前 locale。
     * @param {Function} t 翻译函数。
     * @returns {string} 文本。
     */
    function meterText(meter, localeId, t) {
      if (Number.isFinite(meter.percent)) return formatPercent(meter.percent);
      if (Number.isFinite(meter.value) || Number.isFinite(meter.used)) return formatMeterValue(meter, localeId, t);
      return '–';
    }

    /**
     * meter 副行：重置倒计时 +（按需）已用/上限。
     * @param {Record<string, any>} meter meter。
     * @param {Function} t 翻译函数。
     * @param {string} localeId 当前 locale。
     * @returns {string} 副行文本。
     */
    function meterSubText(meter, t, localeId) {
      const parts = [];
      if (typeof meter.resetsAt === 'string' && meter.resetsAt !== '') {
        const at = Date.parse(meter.resetsAt);
        parts.push(Number.isNaN(at) ? t('meter.resetUnknown') : t('meter.resetIn', { time: durationText(at - Date.now(), t) }));
      }
      if (meter.showValue !== false) {
        if (Number.isFinite(meter.percent) && Number.isFinite(meter.used) && Number.isFinite(meter.limit)) {
          parts.push(`${formatMeterValue({ ...meter, value: meter.used }, localeId, t)} / ${formatMeterValue({ ...meter, value: meter.limit }, localeId, t)}`);
        } else if (Number.isFinite(meter.percent) && Number.isFinite(meter.value)) {
          parts.push(formatMeterValue(meter, localeId, t));
        }
      }
      return parts.join(' · ');
    }

    /**
     * 收起态选中的源。
     * @param {Array<Record<string, any>>} sources 全部源。
     * @param {Record<string, any>} display 展示配置。
     * @returns {Record<string, any> | null} 选中的源。
     */
    function pickPillSource(sources, display) {
      if (!Array.isArray(sources) || sources.length === 0) return null;
      const wanted = display.pillSource;
      if (typeof wanted === 'string' && wanted !== '') {
        const hit = sources.find((source) => source.id === wanted);
        if (hit !== undefined) return hit;
      }
      return sources.find((source) => source.ok === true && Array.isArray(source.meters) && source.meters.length > 0) ?? sources[0];
    }

    /**
     * 收起态选中的 meter。
     * @param {Record<string, any> | null} source 选中的源。
     * @param {Record<string, any>} display 展示配置。
     * @returns {Record<string, any> | null} 选中的 meter。
     */
    function pickPillMeter(source, display) {
      if (source === null || !Array.isArray(source.meters) || source.meters.length === 0) return null;
      const wanted = display.pillMeter;
      if (typeof wanted === 'string' && wanted !== '') {
        const hit = source.meters.find((meter) => meter.key === wanted);
        if (hit !== undefined) return hit;
      }
      const primary = source.meters.find((meter) => meter.primary === true);
      if (primary !== undefined) return primary;
      const withPercent = source.meters.filter((meter) => Number.isFinite(meter.percent));
      if (withPercent.length > 0) {
        return withPercent.reduce((best, meter) => (meter.percent > best.percent ? meter : best));
      }
      return source.meters[0];
    }

    /**
     * 提示块。
     * @param {string | null} notice 提示码。
     * @param {Function} t 翻译函数。
     * @returns {object | null} React 元素。
     */
    function noticeNode(notice, t) {
      if (typeof notice !== 'string' || notice === '') return null;
      const map = {
        'non-go': ['notice.nonGo', 'notice.nonGoDetail'],
        unknown: ['notice.unknown', 'notice.unknownDetail'],
        'balance-empty': ['notice.balanceEmpty', 'notice.balanceEmptyDetail'],
        'no-data': ['notice.noData', 'notice.noDataDetail'],
        partial: ['notice.partial', 'notice.partialDetail'],
      };
      const pair = map[notice];
      if (pair === undefined) return h('div', { className: 'qw-notice' }, h('span', null, notice));
      return h(
        'div',
        { className: 'qw-notice' },
        h('span', null, t(pair[0])),
        h('span', { className: 'qw-notice-detail' }, t(pair[1])),
      );
    }

    /**
     * 源错误块。
     * @param {Record<string, any>} source 源。
     * @param {Function} t 翻译函数。
     * @returns {object} React 元素。
     */
    function errorNode(source, t) {
      const code = source.error?.code;
      let text = t('state.failed');
      let detail = source.error?.message;
      if (code === 'missing-credential') {
        text = t('state.missing', { ref: source.error?.ref ?? t('state.apiKey') });
        detail = null;
      } else if (code === 'credential-rejected') {
        text = t('state.rejected');
        detail = source.driver === 'anthropic-usage' || source.driver === 'openai-usage' ? t('state.adminKey') : null;
      } else if (code === 'config') {
        text = t('state.config');
      }
      return h(
        'div',
        { className: 'qw-error' },
        h('span', null, text),
        detail ? h('span', { className: 'qw-error-detail' }, detail) : null,
      );
    }

    /**
     * 套餐行：到期时间 / 停止续订 / 已过期。
     * @param {Record<string, any> | null} plan 套餐。
     * @param {Function} t 翻译函数。
     * @param {string} localeId 当前 locale。
     * @returns {object | null} React 元素。
     */
    function planNode(plan, t, localeId) {
      if (plan === null || typeof plan !== 'object') return null;
      const notes = [];
      if (typeof plan.endsAt === 'string' && plan.endsAt !== '') {
        const at = Date.parse(plan.endsAt);
        if (!Number.isNaN(at)) notes.push(at < Date.now() ? t('plan.expired') : t('plan.endsAt', { date: shortDate(plan.endsAt, localeId) }));
      }
      if (plan.cancelAtPeriodEnd === true) notes.push(t('plan.cancelAtPeriodEnd'));
      if (notes.length === 0) return null;
      return h('div', { className: 'qw-plan' }, notes.join(' · '));
    }

    /**
     * 今日用量行。
     * @param {Record<string, any>} usage 用量。
     * @param {Function} t 翻译函数。
     * @param {string} localeId 当前 locale。
     * @returns {object | null} React 元素。
     */
    function usageNode(usage, t, localeId) {
      if (usage === null || usage === undefined || typeof usage !== 'object') return null;
      const parts = [];
      if (Number.isFinite(usage.tokens)) parts.push(t('unit.tokens', { tokens: compactNumber(usage.tokens, localeId) }));
      if (Number.isFinite(usage.requests)) parts.push(t('unit.requests', { requests: compactNumber(usage.requests, localeId) }));
      if (Number.isFinite(usage.costUsd)) parts.push(formatCurrency(usage.costUsd, usage.currency ?? 'USD', localeId));
      if (parts.length === 0) return null;
      return h('div', { className: 'qw-usage' }, [t('usage.today'), ...parts].join(' · '));
    }

    /** 一个 14px 的刷新图标（自绘 SVG，不依赖宿主图标包）。 */
    function RefreshGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M13 2.6v2.5h-2.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /** 滑杆图标：打开插件页配置。 */
    function ConfigGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M2.5 4h6.2M12.2 4h1.3M2.5 8h1.6M7.4 8h6.1M2.5 12h7.4M12.9 12h.6',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 10.6, cy: 4, r: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 5.6, cy: 8, r: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 11.4, cy: 12, r: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
      );
    }

    /** 收起态的一条横杠图标。 */
    function ChevronGlyph({ up }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': 'true',
          fill: 'none',
          style: { transform: up ? 'rotate(180deg)' : 'none' },
        },
        h('path', {
          d: 'M4 10l4-4 4 4',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * 收起态图标：选中 meter 的环形进度（外圈是底色，内圈按百分比着色）。
     * @param {{ percent: number, tone: string }} props 百分比与配色。
     * @returns {object} React 元素。
     */
    function RingGlyph({ percent, tone }) {
      const radius = 5;
      const circumference = 2 * Math.PI * radius;
      const filled = clampPercent(percent) / 100;
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
        h('circle', {
          cx: 7,
          cy: 7,
          r: radius,
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: 2,
        }),
        h('circle', {
          cx: 7,
          cy: 7,
          r: radius,
          fill: 'none',
          stroke: tone,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: `${circumference * filled} ${circumference}`,
          transform: 'rotate(-90 7 7)',
        }),
      );
    }

    /**
     * 造一张绑定在当前客户端 context 上的额度浮窗组件。
     *
     * 组件要读 ctx.locale（订阅语言切换）并调用 ctx.slots，所以只能用闭包拿到
     * 客户端根 context——插槽不会把任意注册项当 props 透传给组件。
     * @param {object} ctx 客户端根 context。
     * @returns {object} React 组件。
     */
    /** 宿主 meta 没响应时的兜底驱动器表；正常路径始终用宿主下发的 catalog。 */
    const FALLBACK_CATALOG = [
      {
        id: 'opencode-go',
        label: 'OpenCode Go',
        labelKey: 'source.opencode-go',
        defaultCredential: 'OPENCODE_GO_API_KEY',
        supportsBudget: false,
        isHttp: false,
      },
      {
        id: 'deepseek-balance',
        label: 'DeepSeek',
        labelKey: 'source.deepseek',
        defaultCredential: 'DEEPSEEK_API_KEY',
        supportsBudget: false,
        isHttp: false,
      },
      {
        id: 'anthropic-usage',
        label: 'Anthropic',
        labelKey: 'source.anthropic',
        defaultCredential: 'ANTHROPIC_ADMIN_KEY',
        supportsBudget: true,
        isHttp: false,
      },
      {
        id: 'openai-usage',
        label: 'OpenAI',
        labelKey: 'source.openai',
        defaultCredential: 'OPENAI_ADMIN_KEY',
        supportsBudget: true,
        isHttp: false,
      },
      {
        id: 'http',
        label: 'HTTP',
        labelKey: 'source.http',
        defaultCredential: null,
        supportsBudget: false,
        isHttp: true,
      },
    ];

    /**
     * 深拷贝 JSON 形状的配置。
     * @param {unknown} value 任意 JSON 值。
     * @returns {unknown} 副本。
     */
    function cloneJson(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    /**
     * 把配置整理成表单草稿的形状：三个组都保证存在。
     * @param {Record<string, any> | undefined} value 配置值。
     * @returns {{ sources: Array<Record<string, any>>, cache: Record<string, any>, display: Record<string, any> }} 草稿。
     */
    function draftShape(value) {
      const next = isObject(value) ? cloneJson(value) : {};
      if (!Array.isArray(next.sources)) next.sources = [];
      if (!isObject(next.cache)) next.cache = {};
      if (!isObject(next.display)) next.display = {};
      return next;
    }

    /**
     * 是否是普通对象（不是数组 / null）。
     * @param {unknown} value 任意值。
     * @returns {boolean} 判断结果。
     */
    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    /**
     * 安全 trim。
     * @param {unknown} value 任意值。
     * @returns {string} 去空白后的字符串；非字符串得到空串。
     */
    function trimmed(value) {
      return typeof value === 'string' ? value.trim() : '';
    }

    /**
     * 转数字，失败返回 undefined。
     * @param {unknown} value 任意值。
     * @returns {number | undefined} 数字。
     */
    function numberOr(value) {
      if (value === '' || value === null || value === undefined) return undefined;
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }

    /**
     * 按 id 找 driver 元信息。
     * @param {Array<Record<string, any>>} catalog 驱动器表。
     * @param {unknown} id driver id。
     * @returns {Record<string, any> | undefined} 元信息。
     */
    function driverInfo(catalog, id) {
      return catalog.find((entry) => entry.id === id);
    }

    /**
     * 清洗单个数据源：丢掉空字符串与对当前 driver 无意义的字段，让 schema 默认值生效。
     * @param {Record<string, any>} source 草稿里的源。
     * @param {Array<Record<string, any>>} catalog 驱动器表。
     * @returns {Record<string, any>} 可写入的源。
     */
    function cleanSource(source, catalog) {
      const info = driverInfo(catalog, source.driver);
      const out = {
        id: trimmed(source.id),
        driver: source.driver,
        enabled: source.enabled !== false,
      };
      for (const key of ['label', 'credential', 'baseUrl', 'apiVersion', 'organization']) {
        const value = trimmed(source[key]);
        if (value !== '') out[key] = value;
      }
      const scale = numberOr(source.scale);
      if (scale !== undefined && scale !== 1) out.scale = scale;
      const amount = numberOr(source.budget?.amount);
      if (info?.supportsBudget && amount !== undefined && amount > 0) {
        out.budget = { amount, currency: (trimmed(source.budget?.currency) || 'USD').toUpperCase() };
      }
      if (info?.isHttp === true) {
        const url = trimmed(source.url);
        if (url !== '') out.url = url;
        const auth = isObject(source.auth) ? source.auth : {};
        const type = ['bearer', 'header', 'none'].includes(auth.type) ? auth.type : 'bearer';
        const nextAuth = { type };
        if (trimmed(auth.header) !== '') nextAuth.header = trimmed(auth.header);
        if (trimmed(auth.prefix) !== '') nextAuth.prefix = auth.prefix;
        out.auth = nextAuth;
        for (const key of ['headers', 'query', 'mapping']) {
          const value = source[key];
          if (isObject(value) && Object.keys(value).length > 0) out[key] = cloneJson(value);
        }
      }
      return out;
    }

    /**
     * 把草稿规范化成可直接提交的形状。
     * @param {Record<string, any> | null} draft 草稿。
     * @param {Array<Record<string, any>>} catalog 驱动器表。
     * @returns {{ sources: Array<Record<string, any>>, cache: Record<string, any>, display: Record<string, any> }} 规范化配置。
     */
    function cleanDraft(draft, catalog) {
      const sources = Array.isArray(draft?.sources) ? draft.sources.map((source) => cleanSource(source, catalog)) : [];
      const cache = {};
      for (const key of ['ttlMs', 'errorTtlMs', 'timeoutMs']) {
        const n = numberOr(draft?.cache?.[key]);
        if (n !== undefined) cache[key] = n;
      }
      const display = {};
      const title = trimmed(draft?.display?.title);
      if (title !== '') display.title = title;
      const pillSource = trimmed(draft?.display?.pillSource);
      if (pillSource !== '') display.pillSource = pillSource;
      const pillMeter = trimmed(draft?.display?.pillMeter);
      if (pillMeter !== '') display.pillMeter = pillMeter;
      if (draft?.display?.placement === 'bottom-left') display.placement = 'bottom-left';
      else display.placement = 'bottom-right';
      const pollMs = numberOr(draft?.display?.pollMs);
      if (pollMs !== undefined) display.pollMs = pollMs;
      display.showUsage = draft?.display?.showUsage !== false;
      return { sources, cache, display };
    }

    /**
     * 客户端校验：与宿主 lib/config.js 的 validateConfig 保持同一套规则。
     * 这里提前拦住，避免保存后才在入口行报错。
     * @param {Record<string, any>} draft 草稿。
     * @param {Array<Record<string, any>>} catalog 驱动器表。
     * @param {Record<string, boolean>} jsonErrors 本地 JSON 文本域错误。
     * @returns {Record<string, { key: string, params?: Record<string, unknown> }>} 按路径归类的错误。
     */
    function validateDraft(draft, catalog, jsonErrors) {
      const errors = {};
      const put = (path, key, params) => {
        if (!(path in errors)) errors[path] = params === undefined ? { key } : { key, params };
      };
      const sources = Array.isArray(draft?.sources) ? draft.sources : [];
      if (!Array.isArray(draft?.sources)) put('sources', 'config.error.sources');

      const ids = new Set();
      sources.forEach((source, index) => {
        const at = (key) => `sources.${index}.${key}`;
        const id = trimmed(source.id);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) put(at('id'), 'config.error.id');
        else if (ids.has(id)) put(at('id'), 'config.error.duplicateId');
        else ids.add(id);

        const info = driverInfo(catalog, source.driver);
        if (info === undefined) put(at('driver'), 'config.error.driver');

        const credential = trimmed(source.credential);
        if (credential !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credential)) {
          put(at('credential'), 'config.error.credential');
        }

        if (source.scale !== undefined && source.scale !== '' && numberOr(source.scale) === undefined) {
          put(at('scale'), 'config.error.scale');
        }

        if (info?.isHttp === true) {
          const url = trimmed(source.url);
          if (url === '') put(at('url'), 'config.error.urlRequired');
          else {
            try {
              const parsed = new URL(url);
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                put(at('url'), 'config.error.urlInvalid');
              }
            } catch {
              put(at('url'), 'config.error.urlInvalid');
            }
          }
          if (source.auth?.type === 'header' && trimmed(source.auth.header) === '') {
            put(at('auth.header'), 'config.error.headerRequired');
          }
          if (source.mapping !== undefined && !isObject(source.mapping)) {
            put(at('mapping'), 'config.error.json');
          } else if (isObject(source.mapping) && !('meters' in source.mapping)) {
            put(at('mapping'), 'config.error.meters');
          }
        }

        if (source.budget !== undefined) {
          const amount = numberOr(source.budget?.amount);
          if (info?.supportsBudget !== true) put(at('budget'), 'config.error.budgetDriver');
          else if (amount === undefined) put(at('budget.amount'), 'config.error.number');
          else if (!(amount > 0)) put(at('budget.amount'), 'config.error.budgetAmount');
          else if (String(source.budget?.currency ?? 'USD').toUpperCase() !== 'USD') {
            put(at('budget.currency'), 'config.error.budgetCurrency');
          }
        }
      });

      const cacheLimits = { ttlMs: 1000, errorTtlMs: 500, timeoutMs: 500 };
      for (const [key, min] of Object.entries(cacheLimits)) {
        const n = numberOr(draft?.cache?.[key]);
        if (n === undefined) put(`cache.${key}`, 'config.error.number');
        else if (n < min) put(`cache.${key}`, 'config.error.min', { min });
      }

      const pollMs = numberOr(draft?.display?.pollMs);
      if (pollMs === undefined) put('display.pollMs', 'config.error.number');
      else if (pollMs < 5000) put('display.pollMs', 'config.error.min', { min: 5000 });

      if (draft?.display?.placement !== 'bottom-right' && draft?.display?.placement !== 'bottom-left') {
        put('display.placement', 'config.error.placement');
      }

      const pillSource = trimmed(draft?.display?.pillSource);
      if (pillSource !== '' && !ids.has(pillSource)) put('display.pillSource', 'config.error.pillSource');

      for (const path of Object.keys(jsonErrors ?? {})) {
        errors[path] = { key: 'config.error.json' };
      }
      return errors;
    }

    /**
     * 错误对象转文案。
     * @param {{ key: string, params?: Record<string, unknown> } | undefined} error 错误。
     * @param {Function} t 翻译函数。
     * @returns {string} 文案。
     */
    function errorMessage(error, t) {
      if (error === undefined) return '';
      return error.params === undefined ? t(error.key) : t(error.key, error.params);
    }

    /** 表单里的一个字段：标签 + 控件 + 提示/错误。 */
    function Field({ id, label, hint, error, t, children }) {
      return h(
        'div',
        { className: 'qwcfg-field' },
        h('label', { className: 'qwcfg-label', htmlFor: id }, label),
        children,
        error !== undefined
          ? h('p', { className: 'qwcfg-error', role: 'alert' }, errorMessage(error, t))
          : hint !== undefined
            ? h('p', { className: 'qwcfg-hint' }, hint)
            : null,
      );
    }

    /** 文本输入。 */
    function TextInput({ id, value, onChange, placeholder, disabled, invalid, ariaLabel }) {
      return h('input', {
        id,
        className: 'qwcfg-input',
        type: 'text',
        value: value ?? '',
        placeholder: placeholder ?? '',
        'aria-label': ariaLabel,
        disabled: disabled === true,
        'aria-invalid': invalid === true ? 'true' : undefined,
        onChange: (event) => onChange(event.target.value),
      });
    }

    /** 数字输入；空值原样交给上层处理。 */
    function NumberInput({ id, value, onChange, placeholder, disabled, invalid, min, ariaLabel }) {
      return h('input', {
        id,
        className: 'qwcfg-input',
        type: 'number',
        inputMode: 'numeric',
        step: 'any',
        min,
        value: value ?? '',
        placeholder: placeholder ?? '',
        'aria-label': ariaLabel,
        disabled: disabled === true,
        'aria-invalid': invalid === true ? 'true' : undefined,
        onChange: (event) => onChange(event.target.value),
      });
    }

    /** 下拉选择。 */
    function SelectInput({ id, value, options, onChange, disabled, invalid }) {
      return h(
        'select',
        {
          id,
          className: 'qwcfg-select',
          value: value ?? '',
          disabled: disabled === true,
          'aria-invalid': invalid === true ? 'true' : undefined,
          onChange: (event) => onChange(event.target.value),
        },
        options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
      );
    }

    /** 勾选框。 */
    function CheckInput({ id, checked, onChange, label, disabled }) {
      return h(
        'label',
        { className: 'qwcfg-check', htmlFor: id },
        h('input', {
          id,
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        h('span', null, label),
      );
    }

    /** 多行 JSON 文本域。 */
    function TextAreaInput({ id, value, onChange, disabled, invalid, rows }) {
      return h('textarea', {
        id,
        className: 'qwcfg-textarea',
        rows: rows ?? 5,
        spellCheck: false,
        value: value ?? '',
        disabled: disabled === true,
        'aria-invalid': invalid === true ? 'true' : undefined,
        onChange: (event) => onChange(event.target.value),
      });
    }

    /**
     * 「插件」页里的配置表单：直接读写 settings 里 quota-widget 命名空间的
     * volatile 字段，保存后由宿主热更新浮窗。
     * @param {{ t: Function, configForms: { get: (id: string) => object } }} props 页面属性。
     * @returns {object} React 元素。
     */
    function ConfigPage({ t, configForms }) {
      const form = useMemo(() => configForms.get(ENTRY_ID), [configForms]);
      const subscribe = useCallback((notify) => form.subscribe(notify), [form]);
      const snapshot = useSyncExternalStore(subscribe, () => form.getSnapshot());

      const view = snapshot.value;
      const ready = snapshot.status === 'ready' && isObject(view);

      const [catalog, setCatalog] = useState(FALLBACK_CATALOG);
      const [draft, setDraft] = useState(() => (ready ? draftShape(view) : null));
      const [baseline, setBaseline] = useState(() => (ready ? draftShape(view) : null));
      const [baseRevision, setBaseRevision] = useState(() => (ready ? snapshot.revision : undefined));
      const [saving, setSaving] = useState(false);
      const [saved, setSaved] = useState(false);
      const [failure, setFailure] = useState(null);
      const [conflict, setConflict] = useState(false);
      const [jsonText, setJsonText] = useState({});
      const [jsonErrors, setJsonErrors] = useState({});
      const dirty =
        draft !== null &&
        baseline !== null &&
        JSON.stringify(cleanDraft(draft, catalog)) !== JSON.stringify(cleanDraft(baseline, catalog));
      const errors = draft !== null ? validateDraft(draft, catalog, jsonErrors) : {};
      const invalid = Object.keys(errors).length > 0;
      const readOnly = !snapshot.writable;
      const disabled = readOnly || saving;

      // 驱动器元信息来自宿主；拿不到就退回内置表。
      useEffect(() => {
        let alive = true;
        fetch(`${ENDPOINT}?meta=1`, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!alive) return;
            if (payload?.ok === true && Array.isArray(payload.catalog) && payload.catalog.length > 0) {
              setCatalog(payload.catalog);
            }
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);

      // 跟随 Host 快照：没改动时接受外部更新，有改动时只在 revision 变了才报冲突。
      useEffect(() => {
        if (!ready) return;
        if (draft === null || baseline === null) {
          const next = draftShape(view);
          setDraft(next);
          setBaseline(draftShape(view));
          setBaseRevision(snapshot.revision);
          setJsonText({});
          setJsonErrors({});
          return;
        }
        if (conflict) return;
        if (dirty) {
          if (snapshot.revision !== baseRevision) setConflict(true);
          return;
        }
        if (snapshot.revision !== baseRevision) {
          const next = draftShape(view);
          setDraft(next);
          setBaseline(draftShape(view));
          setBaseRevision(snapshot.revision);
          setJsonText({});
          setJsonErrors({});
        }
      }, [ready, view, snapshot.revision, draft, baseline, dirty, conflict, baseRevision]);

      /** 统一的草稿修改入口。 */
      const edit = useCallback((mutator) => {
        setSaved(false);
        setFailure(null);
        setDraft((prev) => {
          if (prev === null) return prev;
          const next = cloneJson(prev);
          mutator(next);
          return next;
        });
      }, []);

      /** 改一个源的普通字段；空字符串表示删除，交回 schema 默认值。 */
      const setSourceField = useCallback(
        (index, key, value) => {
          edit((next) => {
            const source = next.sources[index];
            if (value === '') delete source[key];
            else source[key] = value;
          });
        },
        [edit],
      );

      /** 改源 id，并跟随 display.pillSource 里的旧 id。 */
      const setSourceId = useCallback(
        (index, value) => {
          edit((next) => {
            const previous = trimmed(next.sources[index].id);
            next.sources[index].id = value;
            if (previous !== '' && trimmed(next.display?.pillSource) === previous) {
              next.display.pillSource = value;
            }
          });
        },
        [edit],
      );

      /** 切换 driver：清掉新 driver 不识别的字段，避免保存即报错。 */
      const setSourceDriver = useCallback(
        (index, driver) => {
          setJsonText({});
          setJsonErrors({});
          edit((next) => {
            const source = next.sources[index];
            source.driver = driver;
            for (const key of ['budget', 'url', 'headers', 'query', 'mapping', 'auth', 'apiVersion', 'organization']) {
              delete source[key];
            }
          });
        },
        [edit],
      );

      /** 改预算金额；清空等于不配预算，非法值留在草稿里由保存前校验拦下。 */
      const setBudgetAmount = useCallback(
        (index, text) => {
          edit((next) => {
            const source = next.sources[index];
            if (trimmed(text) === '') {
              delete source.budget;
              return;
            }
            source.budget = {
              ...(isObject(source.budget) ? source.budget : {}),
              amount: text,
              currency: trimmed(source.budget?.currency) || 'USD',
            };
          });
        },
        [edit],
      );

      /** 改预算币种，只在已经填了金额时保留 budget。 */
      const setBudgetCurrency = useCallback(
        (index, value) => {
          edit((next) => {
            const source = next.sources[index];
            if (isObject(source.budget)) source.budget.currency = value;
          });
        },
        [edit],
      );

      /** 改数值倍率；留空删除，非法值留在草稿里让校验提示。 */
      const setScale = useCallback(
        (index, value) => {
          edit((next) => {
            const source = next.sources[index];
            if (trimmed(value) === '') delete source.scale;
            else source.scale = value;
          });
        },
        [edit],
      );

      /** 改缓存字段。 */
      const setCache = useCallback(
        (key, value) => {
          edit((next) => {
            next.cache[key] = value;
          });
        },
        [edit],
      );

      /** 改显示字段。 */
      const setDisplay = useCallback(
        (key, value) => {
          edit((next) => {
            next.display[key] = value;
          });
        },
        [edit],
      );

      /** 添加一个带唯一 id 的源。 */
      const addSource = useCallback(() => {
        setJsonText({});
        setJsonErrors({});
        edit((next) => {
          const used = new Set(next.sources.map((source) => trimmed(source.id)));
          let n = next.sources.length + 1;
          while (used.has(`source-${n}`)) n += 1;
          next.sources.push({
            id: `source-${n}`,
            driver: catalog[0]?.id ?? 'opencode-go',
            enabled: true,
          });
        });
      }, [catalog, edit]);

      /** 删除源，并清掉指向它的 pillSource。 */
      const removeSource = useCallback(
        (index) => {
          setJsonText({});
          setJsonErrors({});
          edit((next) => {
            const removed = trimmed(next.sources[index]?.id);
            next.sources.splice(index, 1);
            if (removed !== '' && trimmed(next.display?.pillSource) === removed) next.display.pillSource = '';
          });
        },
        [edit],
      );

      /** JSON 文本域：文本单独保存，只有解析成功才写进草稿。 */
      const editJson = useCallback(
        (path, text, applyValue) => {
          setSaved(false);
          setFailure(null);
          setJsonText((prev) => ({ ...prev, [path]: text }));
          if (trimmed(text) === '') {
            setJsonErrors((prev) => {
              const next = { ...prev };
              delete next[path];
              return next;
            });
            applyValue(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(text);
            if (!isObject(parsed)) throw new Error('not an object');
            setJsonErrors((prev) => {
              const next = { ...prev };
              delete next[path];
              return next;
            });
            applyValue(parsed);
          } catch {
            setJsonErrors((prev) => ({ ...prev, [path]: true }));
          }
        },
        [],
      );

      /** 改某个源的 JSON 字段。 */
      const setSourceJson = useCallback(
        (index, key, text) => {
          const path = `sources.${index}.${key}`;
          editJson(path, text, (value) => {
            edit((next) => {
              const source = next.sources[index];
              if (value === undefined) delete source[key];
              else source[key] = value;
            });
          });
        },
        [edit, editJson],
      );

      /** 放弃草稿，回到最近一次已保存/已载入的值。 */
      const discard = useCallback(() => {
        if (baseline === null) return;
        setDraft(cloneJson(baseline));
        setJsonText({});
        setJsonErrors({});
        setSaved(false);
        setFailure(null);
        setConflict(false);
      }, [baseline]);

      /** 冲突后按 Host 当前值重新载入。 */
      const reload = useCallback(() => {
        if (!ready) return;
        const next = draftShape(view);
        setDraft(next);
        setBaseline(draftShape(view));
        setBaseRevision(snapshot.revision);
        setJsonText({});
        setJsonErrors({});
        setSaved(false);
        setFailure(null);
        setConflict(false);
      }, [ready, view, snapshot.revision]);

      /** 只提交有变化的顶层组。 */
      const save = useCallback(async () => {
        if (draft === null || baseline === null || saving || conflict) return;
        if (Object.keys(validateDraft(draft, catalog, jsonErrors)).length > 0) return;
        const next = cleanDraft(draft, catalog);
        const base = cleanDraft(baseline, catalog);
        const ops = [];
        if (JSON.stringify(next.sources) !== JSON.stringify(base.sources)) {
          ops.push({ op: 'set', path: ['sources'], value: next.sources });
        }
        if (JSON.stringify(next.cache) !== JSON.stringify(base.cache)) {
          ops.push({ op: 'set', path: ['cache'], value: next.cache });
        }
        if (JSON.stringify(next.display) !== JSON.stringify(base.display)) {
          ops.push({ op: 'set', path: ['display'], value: next.display });
        }
        if (ops.length === 0) {
          setSaved(true);
          return;
        }
        setSaving(true);
        setSaved(false);
        setFailure(null);
        try {
          const accepted = await form.mutate(ops, baseRevision);
          if (!accepted) {
            setConflict(true);
            return;
          }
          setBaseline(cloneJson(draft));
          setBaseRevision(snapshot.revision);
          setSaved(true);
          window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        } finally {
          setSaving(false);
        }
      }, [draft, baseline, saving, conflict, catalog, t, jsonErrors, form, baseRevision, snapshot.revision]);

      if (snapshot.status === 'loading' || (ready && draft === null)) {
        return h(
          'div',
          { className: 'qwcfg' },
          h('style', null, CSS),
          h('p', { className: 'qwcfg-hint', role: 'status' }, t('config.loading')),
        );
      }

      if (!ready) {
        return h(
          'div',
          { className: 'qwcfg' },
          h('style', null, CSS),
          h('p', { className: 'qwcfg-hint', role: 'status' }, t('config.unavailable')),
        );
      }

      const e = (path) => errors[path];
      const driverOptions = catalog.map((entry) => ({ value: entry.id, label: t(entry.labelKey) || entry.label }));

      /** 渲染一个字段。 */
      const field = (id, label, control, hint, error) =>
        h(Field, { key: id, id, label, hint, error, t }, control);

      /** 渲染一个数据源卡片。 */
      function renderSource(source, index) {
        const info = driverInfo(catalog, source.driver);
        const at = (key) => `sources.${index}.${key}`;
        const common = [
          field(
            `qwcfg-source-${index}-id`,
            t('config.source.id'),
            h(TextInput, {
              id: `qwcfg-source-${index}-id`,
              value: source.id ?? '',
              onChange: (value) => setSourceId(index, value),
              disabled,
              invalid: e(at('id')) !== undefined,
            }),
            t('config.source.idHint'),
            e(at('id')),
          ),
          field(
            `qwcfg-source-${index}-driver`,
            t('config.source.driver'),
            h(SelectInput, {
              id: `qwcfg-source-${index}-driver`,
              value: source.driver,
              options: driverOptions,
              onChange: (value) => setSourceDriver(index, value),
              disabled,
              invalid: e(at('driver')) !== undefined,
            }),
            undefined,
            e(at('driver')),
          ),
          field(
            `qwcfg-source-${index}-label`,
            t('config.source.label'),
            h(TextInput, {
              id: `qwcfg-source-${index}-label`,
              value: source.label ?? '',
              onChange: (value) => setSourceField(index, 'label', value),
              placeholder: info?.label ?? '',
              disabled,
            }),
            t('config.source.labelHint'),
            undefined,
          ),
          field(
            `qwcfg-source-${index}-credential`,
            t('config.source.credential'),
            h(TextInput, {
              id: `qwcfg-source-${index}-credential`,
              value: source.credential ?? '',
              onChange: (value) => setSourceField(index, 'credential', value),
              placeholder: info?.defaultCredential ?? '',
              disabled,
              invalid: e(at('credential')) !== undefined,
            }),
            t('config.source.credentialHint', { ref: info?.defaultCredential ?? '—' }),
            e(at('credential')),
          ),
          field(
            `qwcfg-source-${index}-scale`,
            t('config.source.scale'),
            h(NumberInput, {
              id: `qwcfg-source-${index}-scale`,
              value: source.scale ?? '',
              onChange: (value) => setScale(index, value),
              disabled,
              invalid: e(at('scale')) !== undefined,
            }),
            undefined,
            e(at('scale')),
          ),
        ];

        const specific = [];
        if (!info?.isHttp) {
          specific.push(
            field(
              `qwcfg-source-${index}-baseUrl`,
              t('config.source.baseUrl'),
              h(TextInput, {
                id: `qwcfg-source-${index}-baseUrl`,
                value: source.baseUrl ?? '',
                onChange: (value) => setSourceField(index, 'baseUrl', value),
                placeholder: info?.defaultBaseUrl ?? '',
                disabled,
              }),
              t('config.source.baseUrlHint'),
              undefined,
            ),
          );
        }
        if (source.driver === 'anthropic-usage') {
          specific.push(
            field(
              `qwcfg-source-${index}-apiVersion`,
              t('config.source.apiVersion'),
              h(TextInput, {
                id: `qwcfg-source-${index}-apiVersion`,
                value: source.apiVersion ?? '',
                onChange: (value) => setSourceField(index, 'apiVersion', value),
                disabled,
              }),
              undefined,
              undefined,
            ),
          );
        }
        if (source.driver === 'openai-usage') {
          specific.push(
            field(
              `qwcfg-source-${index}-organization`,
              t('config.source.organization'),
              h(TextInput, {
                id: `qwcfg-source-${index}-organization`,
                value: source.organization ?? '',
                onChange: (value) => setSourceField(index, 'organization', value),
                disabled,
              }),
              undefined,
              undefined,
            ),
          );
        }
        if (info?.supportsBudget === true) {
          specific.push(
            h(
              'div',
              { className: 'qwcfg-field', key: `qwcfg-source-${index}-budget` },
              h('label', { className: 'qwcfg-label' }, t('config.source.budget')),
              h(
                'div',
                { className: 'qwcfg-subgrid' },
                h(NumberInput, {
                  id: `qwcfg-source-${index}-budget-amount`,
                  value: source.budget?.amount ?? '',
                  onChange: (value) => setBudgetAmount(index, value),
                  placeholder: t('config.source.budgetAmount'),
                  ariaLabel: t('config.source.budgetAmount'),
                  disabled,
                  invalid: e(at('budget.amount')) !== undefined || e(at('budget')) !== undefined,
                }),
                source.budget === undefined
                  ? null
                  : h(TextInput, {
                      id: `qwcfg-source-${index}-budget-currency`,
                      value: source.budget.currency ?? 'USD',
                      onChange: (value) => setBudgetCurrency(index, value),
                      ariaLabel: t('config.source.budgetCurrency'),
                      disabled,
                      invalid: e(at('budget.currency')) !== undefined,
                    }),
              ),
              e(at('budget')) !== undefined || e(at('budget.amount')) !== undefined || e(at('budget.currency')) !== undefined
                ? h(
                    'p',
                    { className: 'qwcfg-error', role: 'alert' },
                    errorMessage(e(at('budget')) ?? e(at('budget.amount')) ?? e(at('budget.currency')), t),
                  )
                : null,
            ),
          );
        }

        let httpBlock = null;
        if (info?.isHttp === true) {
          httpBlock = h(
            'details',
            { className: 'qwcfg-advanced', open: isObject(source.mapping) || undefined },
            h('summary', null, t('config.source.advanced')),
            h(
              'div',
              { className: 'qwcfg-subgrid' },
              field(
                `qwcfg-source-${index}-url`,
                t('config.source.url'),
                h(TextInput, {
                  id: `qwcfg-source-${index}-url`,
                  value: source.url ?? '',
                  onChange: (value) => setSourceField(index, 'url', value),
                  placeholder: 'https://example.com/quota',
                  disabled,
                  invalid: e(at('url')) !== undefined,
                }),
                undefined,
                e(at('url')),
              ),
              field(
                `qwcfg-source-${index}-auth`,
                t('config.source.authType'),
                h(SelectInput, {
                  id: `qwcfg-source-${index}-auth`,
                  value: source.auth?.type ?? 'bearer',
                  options: [
                    { value: 'bearer', label: t('config.source.authBearer') },
                    { value: 'header', label: t('config.source.authHeaderMode') },
                    { value: 'none', label: t('config.source.authNone') },
                  ],
                  onChange: (value) => {
                    edit((next) => {
                      const target = next.sources[index];
                      target.auth = { ...(isObject(target.auth) ? target.auth : {}), type: value };
                    });
                  },
                  disabled,
                }),
              ),
            ),
            source.auth?.type === 'header'
              ? h(
                  'div',
                  { className: 'qwcfg-subgrid' },
                  field(
                    `qwcfg-source-${index}-auth-header`,
                    t('config.source.authHeader'),
                    h(TextInput, {
                      id: `qwcfg-source-${index}-auth-header`,
                      value: source.auth?.header ?? '',
                      onChange: (value) => {
                        edit((next) => {
                          const target = next.sources[index];
                          target.auth = { ...(isObject(target.auth) ? target.auth : {}), header: value };
                        });
                      },
                      placeholder: 'Authorization',
                      disabled,
                      invalid: e(at('auth.header')) !== undefined,
                    }),
                    undefined,
                    e(at('auth.header')),
                  ),
                  field(
                    `qwcfg-source-${index}-auth-prefix`,
                    t('config.source.authPrefix'),
                    h(TextInput, {
                      id: `qwcfg-source-${index}-auth-prefix`,
                      value: source.auth?.prefix ?? '',
                      onChange: (value) => {
                        edit((next) => {
                          const target = next.sources[index];
                          target.auth = { ...(isObject(target.auth) ? target.auth : {}), prefix: value };
                        });
                      },
                      placeholder: 'Bearer ',
                      disabled,
                    }),
                    undefined,
                    undefined,
                  ),
                )
              : null,
            field(
              `qwcfg-source-${index}-headers`,
              t('config.source.headers'),
              h(TextAreaInput, {
                id: `qwcfg-source-${index}-headers`,
                value: jsonText[`sources.${index}.headers`] ?? (isObject(source.headers) ? JSON.stringify(source.headers, null, 2) : ''),
                onChange: (text) => setSourceJson(index, 'headers', text),
                disabled,
                invalid: jsonErrors[`sources.${index}.headers`] === true,
                rows: 3,
              }),
              undefined,
              jsonErrors[`sources.${index}.headers`] === true ? { key: 'config.error.json' } : undefined,
            ),
            field(
              `qwcfg-source-${index}-query`,
              t('config.source.query'),
              h(TextAreaInput, {
                id: `qwcfg-source-${index}-query`,
                value: jsonText[`sources.${index}.query`] ?? (isObject(source.query) ? JSON.stringify(source.query, null, 2) : ''),
                onChange: (text) => setSourceJson(index, 'query', text),
                disabled,
                invalid: jsonErrors[`sources.${index}.query`] === true,
                rows: 3,
              }),
              undefined,
              jsonErrors[`sources.${index}.query`] === true ? { key: 'config.error.json' } : undefined,
            ),
            field(
              `qwcfg-source-${index}-mapping`,
              t('config.source.mapping'),
              h(TextAreaInput, {
                id: `qwcfg-source-${index}-mapping`,
                value: jsonText[`sources.${index}.mapping`] ?? (isObject(source.mapping) ? JSON.stringify(source.mapping, null, 2) : ''),
                onChange: (text) => setSourceJson(index, 'mapping', text),
                disabled,
                invalid: e(at('mapping')) !== undefined || jsonErrors[`sources.${index}.mapping`] === true,
                rows: 6,
              }),
              t('config.source.mappingHint'),
              jsonErrors[`sources.${index}.mapping`] === true ? { key: 'config.error.json' } : e(at('mapping')),
            ),
          );
        }

        return h(
          'div',
          { className: 'qwcfg-source', key: index },
          h(
            'div',
            { className: 'qwcfg-source-head' },
            h(
              'span',
              { className: 'qwcfg-source-name' },
              `${trimmed(source.id) || '#'}${info === undefined ? '' : ` · ${t(info.labelKey) || info.label}`}`,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'qwcfg-btn qwcfg-btn-ghost qwcfg-btn-danger',
                disabled,
                onClick: () => removeSource(index),
              },
              t('config.source.remove'),
            ),
          ),
          h(
            'div',
            { className: 'qwcfg-subgrid' },
            h(
              'div',
              { className: 'qwcfg-field' },
              h(CheckInput, {
                id: `qwcfg-source-${index}-enabled`,
                checked: source.enabled !== false,
                onChange: (checked) => setSourceField(index, 'enabled', checked),
                label: t('config.source.enabled'),
                disabled,
              }),
            ),
            ...common,
          ),
          specific.length > 0 ? h('div', { className: 'qwcfg-subgrid' }, ...specific) : null,
          httpBlock,
        );
      }

      const pillSourceOptions = [
        { value: '', label: t('config.auto') },
        ...draft.sources
          .filter((source) => trimmed(source.id) !== '')
          .map((source) => ({ value: trimmed(source.id), label: trimmed(source.id) })),
      ];
      if (
        trimmed(draft.display.pillSource) !== '' &&
        !pillSourceOptions.some((option) => option.value === trimmed(draft.display.pillSource))
      ) {
        pillSourceOptions.push({ value: trimmed(draft.display.pillSource), label: trimmed(draft.display.pillSource) });
      }

      return h(
        'div',
        { className: 'qwcfg' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'qwcfg-head' },
          h('h3', { className: 'qwcfg-title' }, t('config.title')),
          h('p', { className: 'qwcfg-desc' }, t('config.description')),
        ),
        readOnly ? h('p', { className: 'qwcfg-hint', role: 'status' }, t('config.readOnly')) : null,
        conflict
          ? h(
              'div',
              { className: 'qwcfg-notice', role: 'alert' },
              h('span', null, t('config.conflict')),
              h(
                'div',
                { className: 'qwcfg-actions' },
                h('button', { type: 'button', className: 'qwcfg-btn', onClick: reload }, t('config.reload')),
              ),
            )
          : null,
        h(
          'section',
          { className: 'qwcfg-section' },
          h('div', { className: 'qwcfg-section-head' }, h('h4', { className: 'qwcfg-section-title' }, t('config.section.display'))),
          h(
            'div',
            { className: 'qwcfg-grid' },
            field(
              'qwcfg-display-title',
              t('config.display.title'),
              h(TextInput, {
                id: 'qwcfg-display-title',
                value: draft.display.title ?? '',
                onChange: (value) => setDisplay('title', value),
                disabled,
              }),
              t('config.display.titleHint'),
              undefined,
            ),
            field(
              'qwcfg-display-placement',
              t('config.display.placement'),
              h(SelectInput, {
                id: 'qwcfg-display-placement',
                value: draft.display.placement ?? 'bottom-right',
                options: [
                  { value: 'bottom-right', label: t('config.display.bottomRight') },
                  { value: 'bottom-left', label: t('config.display.bottomLeft') },
                ],
                onChange: (value) => setDisplay('placement', value),
                disabled,
                invalid: e('display.placement') !== undefined,
              }),
              undefined,
              e('display.placement'),
            ),
            field(
              'qwcfg-display-pollMs',
              t('config.display.pollMs'),
              h(NumberInput, {
                id: 'qwcfg-display-pollMs',
                value: draft.display.pollMs ?? '',
                onChange: (value) => setDisplay('pollMs', value),
                min: 5000,
                disabled,
                invalid: e('display.pollMs') !== undefined,
              }),
              t('config.display.pollMsHint'),
              e('display.pollMs'),
            ),
            field(
              'qwcfg-display-pillSource',
              t('config.display.pillSource'),
              h(SelectInput, {
                id: 'qwcfg-display-pillSource',
                value: draft.display.pillSource ?? '',
                options: pillSourceOptions,
                onChange: (value) => setDisplay('pillSource', value),
                disabled,
                invalid: e('display.pillSource') !== undefined,
              }),
              t('config.display.pillSourceHint'),
              e('display.pillSource'),
            ),
            field(
              'qwcfg-display-pillMeter',
              t('config.display.pillMeter'),
              h(TextInput, {
                id: 'qwcfg-display-pillMeter',
                value: draft.display.pillMeter ?? '',
                onChange: (value) => setDisplay('pillMeter', value),
                disabled,
              }),
              t('config.display.pillMeterHint'),
              undefined,
            ),
            h(
              'div',
              { className: 'qwcfg-field' },
              h('span', { className: 'qwcfg-label' }, t('config.display.showUsage')),
              h(CheckInput, {
                id: 'qwcfg-display-showUsage',
                checked: draft.display.showUsage !== false,
                onChange: (checked) => setDisplay('showUsage', checked),
                label: t('config.display.showUsage'),
                disabled,
              }),
            ),
          ),
        ),
        h(
          'section',
          { className: 'qwcfg-section' },
          h(
            'div',
            { className: 'qwcfg-section-head' },
            h('h4', { className: 'qwcfg-section-title' }, t('config.section.sources')),
            h(
              'button',
              { type: 'button', className: 'qwcfg-btn', disabled, onClick: addSource },
              t('config.source.add'),
            ),
          ),
          draft.sources.length === 0
            ? h('p', { className: 'qwcfg-hint' }, t('config.source.empty'))
            : draft.sources.map((source, index) => renderSource(source, index)),
        ),
        h(
          'section',
          { className: 'qwcfg-section' },
          h('div', { className: 'qwcfg-section-head' }, h('h4', { className: 'qwcfg-section-title' }, t('config.section.cache'))),
          h(
            'div',
            { className: 'qwcfg-grid' },
            field(
              'qwcfg-cache-ttlMs',
              t('config.cache.ttlMs'),
              h(NumberInput, {
                id: 'qwcfg-cache-ttlMs',
                value: draft.cache.ttlMs ?? '',
                onChange: (value) => setCache('ttlMs', value),
                min: 1000,
                disabled,
                invalid: e('cache.ttlMs') !== undefined,
              }),
              undefined,
              e('cache.ttlMs'),
            ),
            field(
              'qwcfg-cache-errorTtlMs',
              t('config.cache.errorTtlMs'),
              h(NumberInput, {
                id: 'qwcfg-cache-errorTtlMs',
                value: draft.cache.errorTtlMs ?? '',
                onChange: (value) => setCache('errorTtlMs', value),
                min: 500,
                disabled,
                invalid: e('cache.errorTtlMs') !== undefined,
              }),
              undefined,
              e('cache.errorTtlMs'),
            ),
            field(
              'qwcfg-cache-timeoutMs',
              t('config.cache.timeoutMs'),
              h(NumberInput, {
                id: 'qwcfg-cache-timeoutMs',
                value: draft.cache.timeoutMs ?? '',
                onChange: (value) => setCache('timeoutMs', value),
                min: 500,
                disabled,
                invalid: e('cache.timeoutMs') !== undefined,
              }),
              undefined,
              e('cache.timeoutMs'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'qwcfg-footer' },
          saved ? h('span', { className: 'qwcfg-status qwcfg-status-ok', role: 'status' }, t('config.saved')) : null,
          failure !== null
            ? h('span', { className: 'qwcfg-status qwcfg-status-error', role: 'alert' }, failure)
            : null,
          h('span', { className: 'qwcfg-spacer' }),
          h(
            'button',
            { type: 'button', className: 'qwcfg-btn qwcfg-btn-ghost', disabled: !dirty || saving, onClick: discard },
            t('config.discard'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'qwcfg-btn qwcfg-btn-primary',
              disabled: !dirty || invalid || saving || conflict || disabled,
              onClick: () => {
                void save();
              },
            },
            saving ? t('config.saving') : t('config.save'),
          ),
        ),
      );
    }

    function defineWidget(ctx) {
      /** 额度浮窗组件。 */
      function QuotaWidget() {
        const [open, setOpen] = useState(false);
        const [state, setState] = useState({ status: 'idle', payload: null, error: null });
        const [, forceRender] = useState(0);
        const rootRef = useRef(null);
        const pillRef = useRef(null);

        /** locale 切换时重渲染（文案走 ctx.locale.bind 的实时查找）。 */
        useEffect(() => ctx.locale.subscribe(() => forceRender((n) => n + 1)), []);

        const localeId = ctx.locale.getSnapshot().active;
        const t = ctx.locale.bind(NS);
        /** 插件页的跨插件导航；没有权限/没有插件页时隐藏齿轮。 */
        const navigation = ctx.get('pluginNavigation');

        /** 浮窗不透明度：整块一起淡化，默认 100%。 */
        const [opacity, setOpacity] = useState(readStoredOpacity);
        /** 提示条显隐；只在不透明度刚被调整时亮一下。 */
        const [hudOn, setHudOn] = useState(false);
        /** 轮询间隔由宿主下发，首帧用默认值。 */
        const [pollMs, setPollMs] = useState(DEFAULT_POLL_MS);
        /** wheel 监听 / 定时期里读最新值，避免闭包里的旧 opacity。 */
        const opacityRef = useRef(opacity);
        const hudTimerRef = useRef(null);

        /** 提示条亮 OPACITY_HUD_MS，然后自己消失。 */
        const flashOpacityHud = useCallback(() => {
          setHudOn(true);
          if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
          hudTimerRef.current = window.setTimeout(() => {
            hudTimerRef.current = null;
            setHudOn(false);
          }, OPACITY_HUD_MS);
        }, []);

        /** 按档调整不透明度：滚轮向下（steps 为正）更透明，向上更不透明。 */
        const applyOpacitySteps = useCallback(
          (steps) => {
            const next = clampOpacity(opacityRef.current - steps * OPACITY_STEP);
            if (next === opacityRef.current) return;
            opacityRef.current = next;
            setOpacity(next);
            persistOpacity(next);
            flashOpacityHud();
          },
          [flashOpacityHud],
        );

        /** 恢复默认不透明度（点提示条时用）。 */
        const resetOpacity = useCallback(() => {
          opacityRef.current = OPACITY_MAX;
          setOpacity(OPACITY_MAX);
          persistOpacity(OPACITY_MAX);
          flashOpacityHud();
        }, [flashOpacityHud]);

        // 滚轮调不透明度：只接管收起胶囊，展开面板正常滚动。
        useEffect(() => {
          const pill = pillRef.current;
          if (pill === null) return undefined;
          let lastAdjustAt = 0;
          const onWheel = (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.preventDefault();
            const now = Date.now();
            if (now - lastAdjustAt < WHEEL_THROTTLE_MS) return;
            lastAdjustAt = now;
            applyOpacitySteps(event.deltaY > 0 ? 1 : -1);
          };
          pill.addEventListener('wheel', onWheel, { passive: false });
          return () => pill.removeEventListener('wheel', onWheel, { passive: false });
        }, [applyOpacitySteps]);

        // 卸载时清掉提示条定时器。
        useEffect(
          () => () => {
            if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
          },
          [],
        );

        /** 读取一次额度；force 时让宿主跳过缓存。 */
        const load = useCallback(async (force) => {
          setState((prev) => ({ ...prev, status: prev.payload === null ? 'loading' : 'refreshing' }));
          try {
            const response = await fetch(force ? `${ENDPOINT}?force=1` : ENDPOINT, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            setState({ status: 'ready', payload, error: null });
            const nextPoll = Number(payload?.display?.pollMs);
            if (Number.isFinite(nextPoll) && nextPoll >= 5000) setPollMs(nextPoll);
          } catch (error) {
            setState((prev) => ({
              status: prev.payload === null ? 'error' : 'stale',
              payload: prev.payload,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }, []);

        // 首次读取。
        useEffect(() => {
          void load(false);
        }, [load]);

        // 定时轮询；间隔跟着宿主下发的 pollMs 走。
        useEffect(() => {
          const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load(false);
          }, pollMs);
          return () => window.clearInterval(timer);
        }, [load, pollMs]);

        // 页面重新可见时立刻补一次。
        useEffect(() => {
          const onVisible = () => {
            if (document.visibilityState === 'visible') void load(false);
          };
          document.addEventListener('visibilitychange', onVisible);
          return () => document.removeEventListener('visibilitychange', onVisible);
        }, [load]);

        // 配置页保存后立即刷新，不必等下一轮轮询。
        useEffect(() => {
          const onRefresh = () => {
            void load(true);
          };
          window.addEventListener(REFRESH_EVENT, onRefresh);
          return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
        }, [load]);

        // 展开时：点外部或按 Escape 收起。
        useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            const root = rootRef.current;
            if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
            setOpen(false);
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          document.addEventListener('mousedown', onPointerDown, true);
          document.addEventListener('keydown', onKeyDown);
          return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
          };
        }, [open]);

        const payload = state.payload;
        const ready = payload !== null && payload.ok === true;
        const sources = ready && Array.isArray(payload.sources) ? payload.sources : [];
        const display = ready && payload.display !== null && typeof payload.display === 'object' ? payload.display : {};
        const placement = display.placement === 'bottom-left' ? 'bottom-left' : 'bottom-right';
        const title = typeof display.title === 'string' && display.title !== '' ? display.title : t('panel.title');
        const showUsage = display.showUsage !== false;

        const pillSource = pickPillSource(sources, display);
        const pillMeter = pickPillMeter(pillSource, display);
        const pillPercent = pillMeter !== null && Number.isFinite(pillMeter.percent) ? clampPercent(pillMeter.percent) : null;
        const tone = pillPercent !== null
          ? toneOf(pillPercent)
          : pillSource?.ok === true && pillMeter !== null
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-state-idle-primary)';
        const toneStyle = { '--qw-tone': tone };

        let pillText = t('pill.label');
        let pillHint = pillText;
        if (pillSource !== null) {
          const label = sourceLabel(pillSource, t);
          if (pillSource.ok !== true) {
            pillText = `${label} –`;
            pillHint = label;
          } else if (pillMeter === null) {
            pillText = `${label} –`;
            pillHint = label;
          } else {
            const value = meterText(pillMeter, localeId, t);
            pillText = `${label} ${value}`;
            const pieces = [label, labelOf(pillMeter, t), value];
            if (typeof pillMeter.resetsAt === 'string' && pillMeter.resetsAt !== '') {
              const at = Date.parse(pillMeter.resetsAt);
              if (!Number.isNaN(at)) {
                pieces.push(t('meter.resetIn', { time: durationText(at - Date.now(), t) }));
              }
            }
            pillHint = pieces.filter(Boolean).join(' · ');
          }
        }

        /** 单个 meter。 */
        function renderMeter(meter, index) {
          const percent = Number.isFinite(meter.percent) ? clampPercent(meter.percent) : null;
          const sub = meterSubText(meter, t, localeId);
          return h(
            'div',
            { className: 'qw-meter', key: typeof meter.key === 'string' ? meter.key : `meter-${index}` },
            h(
              'div',
              { className: 'qw-meter-head' },
              h('span', { className: 'qw-meter-name' }, labelOf(meter, t)),
              h('span', { className: 'qw-meter-value' }, meterText(meter, localeId, t)),
            ),
            percent !== null
              ? h(
                  'div',
                  { className: 'qw-bar' },
                  h('div', { className: 'qw-bar-cover', style: { left: `${percent}%` } }),
                )
              : null,
            sub !== '' ? h('div', { className: 'qw-meter-sub' }, sub) : null,
          );
        }

        /** 单个源。 */
        function renderSource(source) {
          const label = sourceLabel(source, t);
          const meters = Array.isArray(source.meters) ? source.meters : [];
          const topPercent = meters.reduce(
            (top, meter) => (Number.isFinite(meter.percent) ? Math.max(top, meter.percent) : top),
            0,
          );
          const sourceTone = source.ok === true
            ? topPercent > 0
              ? toneOf(topPercent)
              : 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-state-idle-primary)';
          return h(
            'section',
            { className: 'qw-source', key: source.id },
            h(
              'div',
              { className: 'qw-source-head' },
              h('span', { className: 'qw-dot', style: { '--qw-tone': sourceTone } }),
              h('span', { className: 'qw-source-name', title: label }, label),
              planNode(source.plan ?? null, t, localeId),
            ),
            source.ok === false
              ? errorNode(source, t)
              : noticeNode(source.notice, t),
            source.ok === true && meters.length > 0
              ? h('div', { className: 'qw-meters' }, ...meters.map((meter, index) => renderMeter(meter, index)))
              : null,
            source.ok === true && meters.length === 0 && (typeof source.notice !== 'string' || source.notice === '')
              ? h('div', { className: 'qw-state' }, t('state.noData'))
              : null,
            showUsage ? usageNode(source.usage ?? null, t, localeId) : null,
          );
        }

        /** 展开体：成功时按源分组，失败时是错误说明 + 重试。 */
        function renderBody() {
          if (payload !== null && payload.ok === false) {
            const noSources = payload.error?.code === 'no-sources';
            return h(
              'div',
              { className: 'qw-state' },
              h('span', null, noSources ? t('state.noSources') : t('state.failed')),
              payload.error?.message && !noSources
                ? h('span', { className: 'qw-error-detail' }, payload.error.message)
                : null,
              h(
                'button',
                { type: 'button', className: 'qw-btn', onClick: () => void load(true) },
                t('state.retry'),
              ),
            );
          }
          if (payload === null) {
            return h('div', { className: 'qw-state' }, h('span', null, t('state.loading')));
          }
          if (sources.length === 0) {
            return h(
              'div',
              { className: 'qw-state' },
              h('span', null, t('state.noSources')),
              h(
                'button',
                { type: 'button', className: 'qw-btn', onClick: () => void load(true) },
                t('state.retry'),
              ),
            );
          }
          return h('div', { className: 'qw-sources' }, ...sources.map((source) => renderSource(source)));
        }

        return h(
          'div',
          { className: 'qw-root', ref: rootRef, 'data-placement': placement },
          h('style', null, CSS),
          h(
            'div',
            { className: `qw-hud${hudOn ? ' qw-hud-on' : ''}` },
            h(
              'button',
              {
                type: 'button',
                className: 'qw-hud-chip',
                title: t('opacity.reset'),
                'aria-label': t('opacity.reset'),
                onClick: resetOpacity,
              },
              t('opacity.hint', { percent: Math.round(opacity * 100) }),
            ),
          ),
          open
            ? h(
                'div',
                { className: 'qw-panel', style: { ...toneStyle, opacity }, role: 'dialog', 'aria-label': title },
                h(
                  'div',
                  { className: 'qw-head' },
                  h(
                    'div',
                    { className: 'qw-head-main' },
                    h('span', { className: 'qw-dot', style: toneStyle }),
                    h('span', { className: 'qw-title' }, title),
                    ready
                    ? h(
                        'span',
                        { className: 'qw-sub' },
                        t(sources.length === 1 ? 'panel.sourcesOne' : 'panel.sources', { n: sources.length }),
                      )
                    : null,
                  ),
                  h(
                    'div',
                    { className: 'qw-head-actions' },
                    navigation === undefined
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'qw-icon',
                            title: t('action.configure'),
                            'aria-label': t('action.configure'),
                            onClick: () => navigation.openBundle(BUNDLE_NAME),
                          },
                          h(ConfigGlyph),
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'qw-icon',
                        title: t('action.collapse'),
                        'aria-label': t('action.collapse'),
                        onClick: () => setOpen(false),
                      },
                      h(ChevronGlyph, { up: false }),
                    ),
                  ),
                ),
                renderBody(),
                h(
                  'div',
                  { className: 'qw-foot' },
                  h('span', null, ready ? t('updated', { time: clock(payload.fetchedAt, localeId) }) : ''),
                  h(
                    'span',
                    { className: 'qw-foot-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: `qw-icon${state.status === 'refreshing' || state.status === 'loading' ? ' qw-spin' : ''}`,
                        title: t('action.refresh'),
                        'aria-label': t('action.refresh'),
                        onClick: () => void load(true),
                      },
                      h(RefreshGlyph),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'button',
            {
              ref: pillRef,
              type: 'button',
              className: 'qw-pill',
              style: { ...toneStyle, opacity },
              title: `${pillHint} · ${t('opacity.wheel')}`,
              'aria-expanded': open ? 'true' : 'false',
              'aria-label': open ? t('action.collapse') : t('action.expand'),
              onClick: () => setOpen((value) => !value),
            },
            h(RingGlyph, { percent: pillPercent ?? 0, tone }),
            h('span', null, pillText),
          ),
        );
      }

      return QuotaWidget;
    }

    /** 需要的客户端服务；缺一个就不挂载，避免半套注册。 */
    const inject = ['slots', 'locale'];

    /**
     * 往 shell.overlay 注册浮窗，并在 settings 可用时向插件页注册配置表单。
     * @param {object} ctx 客户端根 context。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quota-widget: 字典');
      const QuotaWidget = defineWidget(ctx);
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'quota-widget',
            order: 40,
          },
          QuotaWidget,
        ),
      );

      // 配置表单依赖 settings 的 configForms；没有它的部署只挂浮窗。
      ctx.inject(['configForms'], (scope) => {
        scope.effect(
          () =>
            scope.slots.inject('plugins.bundle.config', () =>
              scope.slots.register(
                {
                  name: 'plugins.bundle.config',
                  key: BUNDLE_NAME,
                  locale: NS,
                },
                (props) => h(ConfigPage, { t: props.t, configForms: scope.configForms }),
              ),
            ),
          'quota-widget: 插件页配置',
        );
      });

      console.info('[quota-widget] floating quota widget ready');
    }

    exports.apply = apply;
    exports.inject = inject;
    // 纯函数给 Node 单测用；Loader 不读这些额外导出。
    exports.__test = { cleanDraft, validateDraft, draftShape, FALLBACK_CATALOG };
    return module.exports;
  },
});
