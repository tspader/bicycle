import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateTreeRoot, importTree } from '../src/import-tree'

const EXAMPLE_ROOT = new URL('../../../example/machine', import.meta.url).pathname
const FAKE_AGE = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)
const MIN_YAML = 'core:\n  hostname: x\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n'

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'bicycle-import-test-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

test('locateTreeRoot finds bicycle.yml at repo root', () => {
  writeFileSync(join(tmp, 'bicycle.yml'), MIN_YAML)
  expect(locateTreeRoot(tmp)).toBe(tmp)
})

test('locateTreeRoot falls back to .bicycle/ subdir', () => {
  mkdirSync(join(tmp, '.bicycle'))
  writeFileSync(join(tmp, '.bicycle', 'bicycle.yml'), MIN_YAML)
  expect(locateTreeRoot(tmp)).toBe(join(tmp, '.bicycle'))
})

test('locateTreeRoot throws when bicycle.yml is missing', () => {
  expect(() => locateTreeRoot(tmp)).toThrow(/not found/)
})

test('importTree reads text and adopts an adjacent age.key as identity', () => {
  writeFileSync(join(tmp, 'bicycle.yml'), MIN_YAML)
  writeFileSync(join(tmp, 'age.key'), `# created by age-keygen\n# public key: age1...\n${FAKE_AGE}\n`)
  const tree = importTree(tmp)
  expect(tree.text).toBe(MIN_YAML)
  expect(tree.identity).toBe(FAKE_AGE)
  // age.key and bicycle.yml are NOT part of the files map.
  expect(tree.files.has('age.key')).toBe(false)
  expect(tree.files.has('bicycle.yml')).toBe(false)
})

test('importTree skips top-level .git but keeps supporting files', () => {
  writeFileSync(join(tmp, 'bicycle.yml'), MIN_YAML)
  mkdirSync(join(tmp, '.git'))
  writeFileSync(join(tmp, '.git', 'config'), 'gitstuff')
  mkdirSync(join(tmp, 'secrets'), { recursive: true })
  writeFileSync(join(tmp, 'secrets', 'foo.age'), 'cipher')
  mkdirSync(join(tmp, 'apps', 'x'), { recursive: true })
  writeFileSync(join(tmp, 'apps', 'x', 'config.yml'), 'app: 1')
  writeFileSync(join(tmp, 'recipients'), 'age1abc\n')
  const tree = importTree(tmp)
  expect([...tree.files.keys()].some((k) => k.startsWith('.git'))).toBe(false)
  expect(new TextDecoder().decode(tree.files.get('secrets/foo.age')!)).toBe('cipher')
  expect(new TextDecoder().decode(tree.files.get('apps/x/config.yml')!)).toBe('app: 1')
  expect(tree.files.has('recipients')).toBe(true)
})

test('importTree on example/machine: byte-identical text + full supporting tree', () => {
  const tree = importTree(EXAMPLE_ROOT)
  expect(tree.text).toBe(readFileSync(join(EXAMPLE_ROOT, 'bicycle.yml'), 'utf8'))
  expect(tree.text).toContain('hostname: spum-cannon')
  expect(tree.identity).toMatch(/^AGE-SECRET-KEY-/)
  const keys = [...tree.files.keys()]
  expect(keys.some((k) => k.startsWith('apps/'))).toBe(true)
  expect(keys.some((k) => k.startsWith('files/'))).toBe(true)
  expect(keys.some((k) => k.startsWith('secrets/'))).toBe(true)
  expect(tree.files.has('recipients')).toBe(true)
  expect(tree.files.has('secrets/users/spader/password.age')).toBe(true)
})
