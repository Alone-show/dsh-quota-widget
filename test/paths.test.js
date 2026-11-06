import test from 'node:test'
import assert from 'node:assert/strict'
import { getPath, getNumber, parseNumber } from '../lib/paths.js'

test('getPath reads nested objects and indexes', () => {
  const value = { a: { b: [{ c: 3 }, { c: 4 }] }, 'x.y': { z: 5 } }
  assert.equal(getPath(value, 'a.b[0].c'), 3)
  assert.equal(getPath(value, 'a.b[1].c'), 4)
  assert.equal(getPath(value, 'a.b[-1].c'), 4)
  assert.equal(getPath(value, 'x.y'), undefined)
  assert.deepEqual(getPath(value, 'a.b[*].c'), undefined)
})

test('getPath reads quoted keys and empty paths', () => {
  const value = { 'x.y': { z: 5 } }
  assert.equal(getPath(value, '["x.y"].z'), 5)
  assert.equal(getPath(value, ''), value)
  assert.equal(getPath(value, undefined), value)
})

test('getPath returns undefined for missing or invalid paths', () => {
  const value = { a: { b: 1 } }
  assert.equal(getPath(value, 'a.c'), undefined)
  assert.equal(getPath(value, 'a.b[0]'), undefined)
  assert.equal(getPath(value, 'a..b'), undefined)
  assert.equal(getPath(value, 'a['), undefined)
})

test('getNumber parses numeric strings and removes thousands separators', () => {
  assert.equal(getNumber({ n: '1,234.5' }, 'n'), 1234.5)
  assert.equal(getNumber({ n: '  ' }, 'n'), undefined)
  assert.equal(parseNumber(2), 2)
  assert.equal(parseNumber('2'), 2)
  assert.equal(parseNumber('nope'), undefined)
})
