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
    const { useCallback, useEffect, useRef, useState } = React;

    /** 本插件的 locale 命名空间。 */
    const NS = 'quota-widget';
    /** 与宿主 index.js 里的 ROUTE_PATH 保持一致。 */
    const ENDPOINT = '/plugins/quota-widget';
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
     * 往 shell.overlay 注册浮窗。
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
      console.info('[quota-widget] floating quota widget ready');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
