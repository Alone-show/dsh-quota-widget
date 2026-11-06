# dsh-quota-widget

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Web 界面加一个
可展开的额度浮窗。

收起时是右下角一枚小胶囊，显示配置指定的数据源和它的关键额度；点开后按数据源分组列出
全部额度窗口、重置倒计时和今日用量。内置 **OpenCode Go**、**DeepSeek 余额**、
**Anthropic 组织用量**、**OpenAI 组织用量**，以及一个按字段映射配置的 **通用 HTTP** 适配器。


## 环境要求

- DSH（DeepSeek Harness）Web 版；本插件在 `0.2.2-rc.1` 上开发和验证。
- 至少一个数据源的凭据，见下面的[凭据](#凭据)。

## 安装

### 图形界面（推荐）

1. 打开 DSH Web GUI；
2. 左侧边栏点「插件」；
3. 点「添加插件」；
4. 在「包名或地址」里粘贴仓库地址：

   ```
   github:Alone-show/dsh-quota-widget
   ```

   或用完整地址：

   ```
   git+https://github.com/Alone-show/dsh-quota-widget.git
   ```

5. 点「安装」，等出现「已安装」后点「完成」；
6. 插件会热加载到当前页面；右下角没出现胶囊就刷新一次页面。

> 仓库根目录就是插件包，所以地址后面不需要 `#分支` 或子目录后缀；想锁版本可加标签，
> 例如 `github:Alone-show/dsh-quota-widget#v2.0.0`。

### 让 agent 安装

对 agent 说「安装 github:Alone-show/dsh-quota-widget」，对应的工具调用是 `plugin_manager`
的 `install_bundle`，`target` 就是上面的地址。

### 本地目录

先 `git clone` 仓库，然后在「添加插件」里填这个目录的绝对路径。

## 快速开始

不写任何配置时，插件只启用 OpenCode Go，并使用凭据 `OPENCODE_GO_API_KEY`。如果 DSH 已经在
用 `opencode-go` 模型路由，这份 key 通常已经在凭据里了，装完直接可用。

要加别的数据源，按下节写 `sources` 即可。

## 配置

配置写在 profile 的补丁层 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里，用同一个 id
覆盖插件行：

```yaml
- id: quota-widget
  name: dsh-quota-widget
  config:
    ...
```

### 完整示例

```yaml
- id: quota-widget
  name: dsh-quota-widget
  config:
    sources:
      - id: opencode-go
        driver: opencode-go
        credential: OPENCODE_GO_API_KEY

      - id: deepseek
        driver: deepseek-balance
        credential: DEEPSEEK_API_KEY

      - id: anthropic
        driver: anthropic-usage
        credential: ANTHROPIC_ADMIN_KEY
        budget:
          amount: 200
          currency: USD

      - id: openai
        driver: openai-usage
        credential: OPENAI_ADMIN_KEY
        organization: org_xxx          # 可选
        budget:
          amount: 100
          currency: USD

      - id: internal
        driver: http
        label: 内部网关
        credential: INTERNAL_QUOTA_KEY
        url: https://gw.example.com/v1/quota
        auth:
          type: bearer
        mapping:
          meters: data.windows
          fields:
            key: key
            label: label
            used: used
            limit: limit
            resetsAt: resets_at
            unit: usd
          plan:
            label: plan.name
            endsAt: plan.ends_at
          usage:
            tokens: usage.today.tokens

    cache:
      ttlMs: 12000
      errorTtlMs: 5000
      timeoutMs: 8000

    display:
      title: 额度                       # 可选，缺省走 locale
      pillSource: opencode-go           # 收起态显示哪个源
      pillMeter: month                  # 可选，该源的哪个 meter
      placement: bottom-right           # bottom-right | bottom-left
      pollMs: 20000
      showUsage: true
```

> `sources` 一旦配置就 **整体替换** 默认值，不会和默认的 OpenCode Go 合并。想保留
> OpenCode Go，就把它也写进列表。

### 全局配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `sources` | `[opencode-go]` | 数据源列表；整体替换默认值 |
| `cache.ttlMs` | `12000` | 全部源成功时的快照缓存时长 |
| `cache.errorTtlMs` | `5000` | 有源失败时的快照缓存时长 |
| `cache.timeoutMs` | `8000` | 单次上游请求超时 |
| `display.title` | locale | 面板标题 |
| `display.pillSource` | 第一个可用源 | 收起态显示哪个源（必须是已配置的 id） |
| `display.pillMeter` | 适配器的 primary meter | 收起态显示该源的哪个 meter |
| `display.placement` | `bottom-right` | `bottom-right` / `bottom-left` |
| `display.pollMs` | `20000` | 客户端轮询间隔，最低 5000 |
| `display.showUsage` | `true` | 是否显示每个源的今日用量 |

收起态的选源顺序：`pillSource` 指定的源 → 第一个读取成功且有 meter 的源 → 第一个源。
选 meter 的顺序：`pillMeter` 指定的 key → `primary: true` 的 meter → 百分比最高的 meter →
第一个 meter。

### 数据源公共字段

| 字段 | 说明 |
| --- | --- |
| `id` | 必填，`^[a-z0-9][a-z0-9-]*$`，全局唯一 |
| `driver` | `opencode-go` / `deepseek-balance` / `anthropic-usage` / `openai-usage` / `http` |
| `enabled` | 默认 `true`；停用的源不发请求，也不出现在响应里 |
| `label` | 展示名；缺省用适配器的默认名 |
| `credential` | 凭据引用名（POSIX shell 标识符）；配置里只存名字，不存值 |
| `baseUrl` | 覆盖默认 API 根地址 |

其余字段按 driver 取用：`apiVersion`（Anthropic）、`organization`（OpenAI）、
`budget`（Anthropic / OpenAI）、`url` / `headers` / `query` / `auth` / `mapping` / `scale`
（通用 HTTP）。

配置会在插件加载时校验：重复 id、未知 driver、`http` 缺 `url`、`budget` 用在非成本型源、
`pillSource` 指向不存在的 id，都会直接报错，而不是静默降级。

## 凭据

插件按顺序解析每个源的 `credential`：

1. 宿主凭据服务：`~/.dsh/.credentials.yaml` 的 `refs` 段；
2. 进程环境变量。

| Driver | 默认 `credential` | 说明 |
| --- | --- | --- |
| `opencode-go` | `OPENCODE_GO_API_KEY` | OpenCode 的 `oc_sk_…` key；和 DSH 的 `opencode-go` 模型路由共用最方便 |
| `deepseek-balance` | `DEEPSEEK_API_KEY` | DeepSeek 普通 API Key |
| `anthropic-usage` | `ANTHROPIC_ADMIN_KEY` | **必须是 Admin API Key**（`sk-ant-admin01-…`） |
| `openai-usage` | `OPENAI_ADMIN_KEY` | **必须是 Admin API Key**（`sk-admin-…`） |
| `http` | 无 | 是否必需由 `auth.type` 决定 |

补凭据的三种方式：

- 在 DSH 设置 → 模型 / 相关设置里写入对应引用；
- 手动往 `~/.dsh/.credentials.yaml` 的 `refs` 加一行：

  ```yaml
  refs:
    OPENCODE_GO_API_KEY: oc_sk_xxxxxxxx
    DEEPSEEK_API_KEY: sk-xxxxxxxx
  ```

- 或在启动 DSH 前 `export OPENCODE_GO_API_KEY=...`。

换 key 不用重装插件，下一次请求就会用新 key。

> Anthropic / OpenAI 的组织用量接口只认 Admin API Key。普通 API Key 会以
> `credential-rejected` 失败，浮窗会给出对应提示。DeepSeek 官方只提供余额接口，
> 没有公开的用量接口，所以 `deepseek-balance` 只显示余额。

## 内置 driver

### `opencode-go`

- 并发读取 `GET {baseUrl}/go/status` 与 `GET {baseUrl}/activity/go`，Bearer 认证。
- 三个窗口：`fiveHour` / `week` / `month`，单位 USD；收起态默认取 `month`。
- `access.meters` 里的 `limitMicroCents` / `usedMicroCents`（1e-8 美元）换算成美元后算百分比；
  界面只显示百分比，不显示金额。
- 今日 tokens / 请求数 / 成本来自按天汇总里日期等于今天的一条。
- 非 Go 订阅显示 `non-go` 提示，仍保留今日用量。
- 默认 `baseUrl = https://opencode.ai/console/api`。

### `deepseek-balance`

- 读取 `GET {baseUrl}/user/balance`，Bearer 认证。
- `balance_infos[]` 每个币种一个 meter：`{currency} 余额`，只显示数值、不画百分比条。
- `is_available: false` 时给出余额不足提示。
- 没有用量数据；要显示 DeepSeek 用量请用 `http` driver 指向自建代理。
- 默认 `baseUrl = https://api.deepseek.com`。

### `anthropic-usage`

- 需要 Admin API Key；默认 `baseUrl = https://api.anthropic.com`，
  `apiVersion = 2023-06-01`（可用 `apiVersion` 覆盖）。
- 并发读取当月：
  - `GET /v1/organizations/cost_report`
  - `GET /v1/organizations/usage_report/messages`
- 成本接口的 `amount` 是 **分** 的十进制字符串，插件除以 100 得到 USD。
- 月度成本 meter（`monthCost`）；配置 `budget` 时用预算算百分比，不配时只显示金额。
- 今日 tokens 累加 `uncached_input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens + output_tokens`，今日成本按 bucket 的本地日期匹配。
- 时间窗是「本月 1 日至今」；只取第一页（`limit=31`，覆盖当月日桶），不跟随分页。
- 两个接口有一个失败时，另一个仍会显示，并给出 `partial` 提示。

### `openai-usage`

- 需要 Admin API Key；默认 `baseUrl = https://api.openai.com/v1`。
- 并发读取当月：
  - `GET /organization/costs`
  - `GET /organization/usage/completions`
- 成本 `amount.value` 是 USD 数值；用量累加 `input_tokens + output_tokens` 和
  `num_model_requests`。
- 月度成本 meter（`monthCost`）；配置 `budget` 时算百分比，不配时只显示金额。
- `organization` 配置会加 `OpenAI-Organization` 头。
- 同样只取第一页（`limit=31`），不跟随分页；单个接口失败时给 `partial` 提示。

## 通用 HTTP driver

`http` 支持两种模式。

### 1. 标准化契约（不配 `mapping`）

上游直接返回：

```json
{
  "plan": { "label": "Pro", "endsAt": "2026-12-01T00:00:00Z" },
  "meters": [
    { "key": "month", "label": "本月", "used": 5, "limit": 10, "unit": "usd", "resetsAt": "2026-12-01T00:00:00Z" }
  ],
  "usage": { "tokens": 1234, "requests": 12, "costUsd": 1.5 },
  "notice": null
}
```

`meters` 必须是数组。`meters[].unit` 支持 `usd` / `currency` / `percent` / `count` /
`tokens` / `requests`；`meter` 可带 `label`、`labelKey`、`labelParams`、`value`、
`percent`、`showValue`、`primary`。

### 2. 字段映射（配 `mapping`）

```yaml
- id: internal
  driver: http
  label: 内部网关
  credential: INTERNAL_QUOTA_KEY
  url: https://gw.example.com/v1/quota
  headers:
    x-tenant: team-a
  query:
    at: '{now}'
  auth:
    type: bearer            # bearer | header | none
  mapping:
    meters: data.windows    # 指向数组
    fields:
      key: key
      label: label
      used: used
      limit: limit
      resetsAt: resets_at
      unit: usd
    plan:
      label: plan.name
      endsAt: plan.ends_at
      cancelAtPeriodEnd: plan.cancel_at_period_end
    usage:
      tokens: usage.today.tokens
      requests: usage.today.requests
      costUsd: usage.today.cost_usd
```

- `mapping.meters` 是字符串时，按路径取数组，`fields.*` 相对每个数组元素。
- `mapping.meters` 是数组时，每个元素就是一份显式 meter 定义，字段是相对整个响应根对象的
  绝对路径：

  ```yaml
  mapping:
    meters:
      - key: month
        label: 本月
        used: usage.month.used
        limit: usage.month.limit
        unit: usd
        primary: true
  ```

- 路径语法：`a.b`、`a[0].b`、`a["x.y"]`；不支持通配符、过滤或聚合。
- `used` / `limit` / `value` / `percent` 写数字表示静态值，写字符串表示路径。
- `scale` 会乘到读到的 `used` / `limit` / `value` 上（适合 microCent、分等单位的接口）；
  数据源级 `scale` 和 meter 级 `scale` 会相乘。
- `unit` 在 `fields` 里可以写字面量（`usd`、`tokens` 等），也可以写路径；`currency` 同理。
- `headers` / `query` 支持占位符 `{now}`、`{monthStart}`（ISO）和 `{nowUnix}`、
  `{monthStartUnix}`。
- 只支持 GET；不支持 POST / GraphQL / 多请求编排。复杂场景用内置 driver 或自建代理。

## 工作方式

宿主半侧（`index.js` + `lib/`）注册一个同源只读路由，替浏览器去取各源的上游接口；
浏览器半侧（`client.js`）只读这个路由，不接触任何凭据。

```
GET /plugins/quota-widget          读取（命中缓存则不发上游请求）
GET /plugins/quota-widget?force=1  跳过缓存，强制刷新（浮窗里的刷新按钮）
```

**为什么不在浏览器里直接请求上游**：各服务商的额度接口不返回跨域许可，浏览器会被 CORS
挡掉；而且 API Key 只能留在宿主进程里，不能下发到页面。

响应示例：

```jsonc
{
  "ok": true,
  "fetchedAt": "2026-11-06T04:00:00.000Z",
  "display": {
    "title": null,
    "pollMs": 20000,
    "pillSource": "opencode-go",
    "pillMeter": null,
    "placement": "bottom-right",
    "showUsage": true
  },
  "sources": [
    {
      "id": "opencode-go",
      "label": "OpenCode Go",
      "labelKey": "source.opencode-go",
      "driver": "opencode-go",
      "ok": true,
      "plan": {
        "label": "Go",
        "endsAt": "2026-11-20T04:00:05.000Z"
      },
      "meters": [
        {
          "key": "month",
          "labelKey": "meter.month",
          "percent": 19.2,
          "used": 11.5,
          "limit": 60,
          "unit": "usd",
          "currency": "USD",
          "showValue": false,
          "resetsAt": "2026-11-20T04:00:05.000Z",
          "primary": true
        }
      ],
      "usage": { "date": "2026-11-06", "tokens": 168885802, "requests": 1100, "costUsd": 2.93 },
      "notice": null,
      "error": null
    }
  ],
  "error": null
}
```

- 顶层 `ok` 表示路由整体可用；单个源失败用 `source.ok: false` + `source.error`。
- 错误 code：`missing-credential`（带 `ref` 引用名）、`credential-rejected`、`upstream`、
  `config`。
- 没有任何启用源时返回 `{ ok: false, error: { code: "no-sources" } }`。
- 上游响应体、请求头和账号标识不下发；错误 message 不拼接上游响应体。
- 所有源并发读取；全部成功用 `ttlMs` 缓存，任一失败用 `errorTtlMs` 缓存；并发请求合并成一次。
- 客户端默认每 20 秒轮询一次，页面重新可见时立刻补一次。

## 使用

- **收起态**：胶囊显示选中的数据源和关键额度，左侧小圆环是进度；颜色随水位变化
  （<70% 品牌色，<90% 警告色，其余错误色）。
- **展开态**：点胶囊展开面板，按源分组显示 meters、重置倒计时、套餐到期日和今日用量；
  底部有更新时间和刷新按钮。
- **收起面板**：点浮窗外面、按 `Escape`，或点面板右上角的收起按钮。
- **调透明度**：鼠标停在收起胶囊上滚动滚轮，向上更不透明、向下更透明；每档 5%，
  范围 25%–100%，默认 100%。调整时上方浮出「透明度 85%」，点它恢复 100%。
  `Ctrl` / `⌘` / `Alt` + 滚轮仍交给浏览器，触控板横向滑动不会误触。

## 排错

| 现象 | 处理 |
| --- | --- |
| 右下角没有胶囊 | 刷新一次页面；仍没有就看插件页里 `dsh-quota-widget` 是否「运行中」 |
| 面板只有部分源 | 每个源独立报错；看对应源的错误块，缺凭据 / Admin Key 被拒最常见 |
| 提示「未配置 XXX_API_KEY」 | 按[凭据](#凭据)补上该引用 |
| 提示「API Key 被拒绝」 | key 过期、被撤销，或 Anthropic / OpenAI 用了普通 API Key 而不是 Admin Key |
| 提示「额度映射配置有误」 | 检查 `mapping.meters` 路径、`fields` 字段名是否和上游 JSON 一致 |
| 提示「余额不足」 | DeepSeek 余额不够，充值即可 |
| 数字比控制台晚一点 | 宿主缓存 12 秒 + 前端 20 秒轮询，属正常；点刷新按钮可立即取 |
| 滚轮没反应 / 页面跟着滚 | 滚轮只在收起胶囊上调整透明度；展开面板正常滚动 |
| 浮窗被调得太淡 | 点浮出提示恢复 100%，或向上滚回去；下限 25% 保证还能看见 |

调试接口：

```bash
curl -s http://127.0.0.1:3080/plugins/quota-widget | jq
curl -s 'http://127.0.0.1:3080/plugins/quota-widget?force=1' | jq
```

## 开发与测试

```bash
npm install
npm test
node --check index.js client.js lib/*.js lib/adapters/*.js test/*.js
```

测试用 Node 内置 `node:test`，覆盖路径解析、meter 归一化、配置校验、五个适配器和路由缓存。

改插件代码时：客户端会热替换；**宿主侧** `index.js` / `lib/` 的改动需要在插件页把本插件
「停用 → 启用」一次。

## 卸载

插件页里点「卸载」即可。要连凭据一起清掉，再删掉 `refs` 里对应的引用（前提是不再需要它们
做模型路由）。

## 许可

[MIT](LICENSE)
