import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 浏览器 bundle 的 Node 冒烟测试：用一个最小 React / ModuleLoader 桩把
 * client.js 加载进来，只测与渲染无关的纯函数（草稿清洗与校验）。
 * 渲染仍以真实 Web 页面为准。
 */
const React = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

let plugin
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      plugin = spec.factory((id) => {
        if (id === 'react') return React
        throw new Error(`unexpected module ${id}`)
      })
    },
  },
}

await import('../client.js')

const { cleanDraft, validateDraft, draftShape, FALLBACK_CATALOG, CSS } = plugin.__test

/**
 * 一份合法草稿。
 * @param {Record<string, any>} [overrides] 覆盖字段。
 * @returns {Record<string, any>} 草稿。
 */
function validDraft(overrides = {}) {
  return {
    sources: [{ id: 'opencode-go', driver: 'opencode-go', enabled: true, credential: 'OPENCODE_GO_API_KEY' }],
    cache: { ttlMs: 12000, errorTtlMs: 5000, timeoutMs: 8000 },
    display: { placement: 'bottom-right', pollMs: 20000, showUsage: true },
    ...overrides,
  }
}

test('draftShape always provides the three groups', () => {
  assert.deepEqual(draftShape(undefined), { sources: [], cache: {}, display: {} })
  assert.deepEqual(draftShape({ sources: [{ id: 'a' }] }), {
    sources: [{ id: 'a' }],
    cache: {},
    display: {},
  })
})

test('cleanDraft drops empty optional fields and defaults', () => {
  const cleaned = cleanDraft(
    {
      sources: [
        {
          id: ' a ',
          driver: 'opencode-go',
          enabled: true,
          label: '  ',
          credential: 'MY_KEY',
          baseUrl: '',
          scale: '2',
        },
      ],
      cache: { ttlMs: '9000', errorTtlMs: '4000', timeoutMs: '3000' },
      display: { title: '  ', pillSource: '', pillMeter: 'fiveHour', placement: 'bottom-left', pollMs: '15000', showUsage: false },
    },
    FALLBACK_CATALOG,
  )
  assert.deepEqual(cleaned.sources, [
    { id: 'a', driver: 'opencode-go', enabled: true, credential: 'MY_KEY', scale: 2 },
  ])
  assert.deepEqual(cleaned.cache, { ttlMs: 9000, errorTtlMs: 4000, timeoutMs: 3000 })
  assert.deepEqual(cleaned.display, {
    pillMeter: 'fiveHour',
    placement: 'bottom-left',
    pollMs: 15000,
    showUsage: false,
  })
})

test('cleanDraft keeps HTTP fields and drops a budget on non-cost drivers', () => {
  const cleaned = cleanDraft(
    {
      sources: [
        {
          id: 'custom',
          driver: 'http',
          enabled: true,
          url: 'https://example.com/quota',
          auth: { type: 'header', header: 'X-Key', prefix: '' },
          headers: { 'X-Env': 'prod' },
          query: {},
          mapping: { meters: '[].meters' },
        },
        { id: 'go', driver: 'opencode-go', enabled: false, budget: { amount: 20, currency: 'USD' } },
      ],
      cache: {},
      display: {},
    },
    FALLBACK_CATALOG,
  )
  assert.equal(cleaned.sources[0].url, 'https://example.com/quota')
  assert.deepEqual(cleaned.sources[0].auth, { type: 'header', header: 'X-Key' })
  assert.deepEqual(cleaned.sources[0].headers, { 'X-Env': 'prod' })
  assert.equal('query' in cleaned.sources[0], false)
  assert.deepEqual(cleaned.sources[0].mapping, { meters: '[].meters' })
  assert.equal('budget' in cleaned.sources[1], false)
})

test('validateDraft accepts the default configuration', () => {
  assert.deepEqual(validateDraft(validDraft(), FALLBACK_CATALOG, {}), {})
})

test('validateDraft rejects duplicate ids and bad id patterns', () => {
  const duplicate = validDraft({
    sources: [
      { id: 'a', driver: 'opencode-go', enabled: true },
      { id: 'a', driver: 'deepseek-balance', enabled: true },
    ],
  })
  assert.equal(validateDraft(duplicate, FALLBACK_CATALOG, {})['sources.1.id'].key, 'config.error.duplicateId')

  const bad = validDraft({ sources: [{ id: 'Bad Id', driver: 'opencode-go', enabled: true }] })
  assert.equal(validateDraft(bad, FALLBACK_CATALOG, {})['sources.0.id'].key, 'config.error.id')
})

test('validateDraft enforces HTTP requirements and mapping meters', () => {
  const missingUrl = validDraft({
    sources: [{ id: 'custom', driver: 'http', enabled: true, auth: { type: 'bearer' } }],
  })
  assert.equal(validateDraft(missingUrl, FALLBACK_CATALOG, {})['sources.0.url'].key, 'config.error.urlRequired')

  const badProtocol = validDraft({
    sources: [{ id: 'custom', driver: 'http', enabled: true, url: 'ftp://example.com' }],
  })
  assert.equal(validateDraft(badProtocol, FALLBACK_CATALOG, {})['sources.0.url'].key, 'config.error.urlInvalid')

  const noMeters = validDraft({
    sources: [
      {
        id: 'custom',
        driver: 'http',
        enabled: true,
        url: 'https://example.com',
        mapping: { fields: {} },
      },
    ],
  })
  assert.equal(validateDraft(noMeters, FALLBACK_CATALOG, {})['sources.0.mapping'].key, 'config.error.meters')

  const headerRequired = validDraft({
    sources: [
      { id: 'custom', driver: 'http', enabled: true, url: 'https://example.com', auth: { type: 'header', header: ' ' } },
    ],
  })
  assert.equal(
    validateDraft(headerRequired, FALLBACK_CATALOG, {})['sources.0.auth.header'].key,
    'config.error.headerRequired',
  )
})

test('validateDraft enforces budgets, minimums and pillSource', () => {
  const budgetOnOpencode = validDraft({
    sources: [{ id: 'go', driver: 'opencode-go', enabled: true, budget: { amount: 10, currency: 'USD' } }],
  })
  assert.equal(validateDraft(budgetOnOpencode, FALLBACK_CATALOG, {})['sources.0.budget'].key, 'config.error.budgetDriver')

  const badAmount = validDraft({
    sources: [{ id: 'a', driver: 'openai-usage', enabled: true, budget: { amount: 'abc', currency: 'USD' } }],
  })
  assert.equal(validateDraft(badAmount, FALLBACK_CATALOG, {})['sources.0.budget.amount'].key, 'config.error.number')

  const badCurrency = validDraft({
    sources: [{ id: 'a', driver: 'anthropic-usage', enabled: true, budget: { amount: 10, currency: 'CNY' } }],
  })
  assert.equal(
    validateDraft(badCurrency, FALLBACK_CATALOG, {})['sources.0.budget.currency'].key,
    'config.error.budgetCurrency',
  )

  const tooSmall = validDraft({ cache: { ttlMs: 999, errorTtlMs: 5000, timeoutMs: 8000 }, display: { placement: 'bottom-right', pollMs: 4000 } })
  const errors = validateDraft(tooSmall, FALLBACK_CATALOG, {})
  assert.deepEqual(errors['cache.ttlMs'], { key: 'config.error.min', params: { min: 1000 } })
  assert.deepEqual(errors['display.pollMs'], { key: 'config.error.min', params: { min: 5000 } })

  const badPill = validDraft({ display: { placement: 'bottom-right', pollMs: 20000, pillSource: 'missing' } })
  assert.equal(validateDraft(badPill, FALLBACK_CATALOG, {})['display.pillSource'].key, 'config.error.pillSource')
})

test('validateDraft surfaces JSON textarea errors by path', () => {
  const errors = validateDraft(validDraft(), FALLBACK_CATALOG, { 'sources.0.mapping': true })
  assert.equal(errors['sources.0.mapping'].key, 'config.error.json')
})

test('apply registers the overlay and the bundle config page', () => {
  const specs = []
  const injections = []
  const pageRegistrations = []
  const slots = {
    inject(key, callback) {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    register(spec, component) {
      specs.push({ spec, component })
      return () => {}
    },
  }
  const base = {
    effect(fn) {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    locale: { register: () => () => {} },
    slots,
    inject(deps, callback) {
      injections.push(deps)
      callback({
        effect: base.effect,
        slots: {
          ...slots,
          inject(key, inner) {
            inner()
            return () => {}
          },
          register(spec, component) {
            pageRegistrations.push({ spec, component })
            return () => {}
          },
        },
        configForms: { get: () => ({}) },
      })
      return { dispose() {} }
    },
  }

  plugin.apply(base)

  assert.equal(
    specs.some(({ spec }) => spec.name === 'shell.overlay' && spec.id === 'quota-widget'),
    true,
  )
  assert.deepEqual(injections, [['configForms']])
  assert.equal(pageRegistrations.length, 1)
  assert.equal(pageRegistrations[0].spec.name, 'plugins.bundle.config')
  assert.equal(pageRegistrations[0].spec.key, 'dsh-quota-widget')
  assert.equal(pageRegistrations[0].spec.locale, 'quota-widget')
  assert.equal(typeof pageRegistrations[0].component, 'function')
})

test('配置表单不用浮层底色，保存栏跟页面背景同色', () => {
  const rules = CSS.match(/\.qwcfg[^{}]*\{[^{}]*\}/g) ?? []
  assert.ok(rules.length > 10, '应当解析出配置表单的样式规则')
  assert.deepEqual(
    rules.filter((rule) => rule.includes('--dsw-alias-bg-overlay')),
    [],
    '配置表单不能把 overlay（深色下 #61666b）当底色',
  )

  const footer = rules.find((rule) => rule.startsWith('.qwcfg-footer{'))
  assert.ok(footer !== undefined, '保存栏必须有样式规则')
  assert.match(footer, /background:var\(--dsw-alias-bg-base\)/)

  // 深色主题下 brand 填充接近白色，主按钮文字必须用宿主的前景色，
  // 否则会白底白字。
  const primary = rules.find((rule) => rule.startsWith('.qwcfg-btn-primary{'))
  assert.ok(primary !== undefined, '主按钮必须有样式规则')
  assert.match(primary, /color:var\(--dsw-alias-label-primary-foreground\)/)
})
