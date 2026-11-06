/**
 * 极简 JSON 路径读取：支持 `a.b`、`a[0].b` 与 `a["x.y"]`。
 *
 * 不实现通配符、过滤和聚合——需要聚合的提供方由内置 adapter 处理。
 */

/**
 * 把路径拆成 key / index 记号；非法路径返回 null。
 * @param {string} path 路径。
 * @returns {Array<{ type: 'key', key: string } | { type: 'index', index: number }> | null} 记号。
 */
function tokenize(path) {
  if (path.includes('..') || path.startsWith('.') || path.endsWith('.')) return null
  const tokens = []
  let key = ''
  let hasKey = false
  const pushKey = () => {
    if (!hasKey) return
    tokens.push({ type: 'key', key })
    key = ''
    hasKey = false
  }

  let index = 0
  while (index < path.length) {
    const char = path[index]
    if (char === '.') {
      pushKey()
      index += 1
      continue
    }
    if (char === '[') {
      pushKey()
      const end = path.indexOf(']', index)
      if (end === -1) return null
      const raw = path.slice(index + 1, end).trim()
      if (raw === '') return null
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        tokens.push({ type: 'key', key: raw.slice(1, -1) })
      } else if (/^-?\d+$/.test(raw)) {
        tokens.push({ type: 'index', index: Number(raw) })
      } else {
        return null
      }
      index = end + 1
      continue
    }
    key += char
    hasKey = true
    index += 1
  }
  pushKey()
  return tokens
}

/**
 * 按路径取一个值；任何一段缺失都返回 undefined。
 * @param {unknown} value 根值。
 * @param {string | undefined} path 路径；空路径返回根值。
 * @returns {unknown} 取到的值。
 */
export function getPath(value, path) {
  if (path === undefined || path === null || path === '') return value
  if (typeof path !== 'string') return undefined
  const tokens = tokenize(path)
  if (tokens === null) return undefined

  let current = value
  for (const token of tokens) {
    if (token.type === 'key') {
      if (current === null || typeof current !== 'object') return undefined
      if (!Object.prototype.hasOwnProperty.call(current, token.key)) return undefined
      current = current[token.key]
      continue
    }
    if (!Array.isArray(current)) return undefined
    const position = token.index < 0 ? current.length + token.index : token.index
    if (position < 0 || position >= current.length) return undefined
    current = current[position]
  }
  return current
}

/**
 * 按路径取数字；字符串会去掉千分位后转数字。
 * @param {unknown} value 根值。
 * @param {string | undefined} path 路径。
 * @returns {number | undefined} 有限数字，否则 undefined。
 */
export function getNumber(value, path) {
  return parseNumber(getPath(value, path))
}

/**
 * 把接口里的数字或数字字符串转成有限数字。
 * @param {unknown} value 原始值。
 * @returns {number | undefined} 有限数字，否则 undefined。
 */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/,/g, '')
  if (text === '') return undefined
  const number = Number(text)
  return Number.isFinite(number) ? number : undefined
}
