import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateConfigTree, applyConfigTree } from '../src/import-tree'
import { getSource, clearSource, replaceState } from '../src/state'
import { getAgeKey, setAgeKey } from '../src/ui-state'
import { testMachine } from '../src/config'

const EXAMPLE_ROOT = new URL('../../../example/machine', import.meta.url).pathname

const FAKE_AGE = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bicycle-import-test-'))
  clearSource()
  setAgeKey(null)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearSource()
  setAgeKey(null)
})

test('locateConfigTree finds bicycle.yml at repo root', () => {
  writeFileSync(join(tmp, 'bicycle.yml'), 'core:\n  hostname: x\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n')
  const loc = locateConfigTree(tmp)
  expect(loc.treeRoot).toBe(tmp)
  expect(loc.text).toContain('hostname: x')
  expect(loc.ageIdentity).toBeNull()
})

test('locateConfigTree falls back to .bicycle/ subdir', () => {
  mkdirSync(join(tmp, '.bicycle'))
  writeFileSync(join(tmp, '.bicycle', 'bicycle.yml'), 'core:\n  hostname: y\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n')
  const loc = locateConfigTree(tmp)
  expect(loc.treeRoot).toBe(join(tmp, '.bicycle'))
})

test('locateConfigTree picks up adjacent age.key', () => {
  writeFileSync(join(tmp, 'bicycle.yml'), 'core:\n  hostname: z\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n')
  writeFileSync(join(tmp, 'age.key'), `# created by age-keygen\n# public key: age1...\n${FAKE_AGE}\n`)
  const loc = locateConfigTree(tmp)
  expect(loc.ageIdentity).toBe(FAKE_AGE)
})

test('locateConfigTree throws when bicycle.yml is missing', () => {
  expect(() => locateConfigTree(tmp)).toThrow(/not found/)
})

test('end-to-end: locate + apply example/machine/ yields populated state and source', () => {
  // Use the real example tree as a fixture. This is exactly what
  // a freshly-cloned config repo looks like.
  const loc = locateConfigTree(EXAMPLE_ROOT)
  expect(loc.text).toContain('hostname: spum-cannon')
  expect(loc.ageIdentity).toBeTruthy()

  // Tree carries the supporting subdirs the daemon needs at runtime —
  // these must reach /mnt/etc/bicycle for the example to be functional.
  expect(existsSync(join(loc.treeRoot, 'apps'))).toBe(true)
  expect(existsSync(join(loc.treeRoot, 'files'))).toBe(true)
  expect(existsSync(join(loc.treeRoot, 'secrets'))).toBe(true)
  expect(existsSync(join(loc.treeRoot, 'recipients'))).toBe(true)

  applyConfigTree(loc, testMachine({ disks: { '/dev/vda': 32 * 1024 ** 3 } }))

  const src = getSource()
  expect(src).not.toBeNull()
  expect(src!.tree).toBe(EXAMPLE_ROOT)
  expect(src!.yaml).toContain('hostname: spum-cannon')
  expect(getAgeKey()).toBe(loc.ageIdentity)
})

test('applyConfigTree clones-then-yaml flow: yaml comes from disk, not derivation', () => {
  // The on-disk YAML has comments and a top-level `vars:` table — neither
  // would survive a derive+re-serialize round-trip through ArchinstallConfig.
  // Source preservation is exactly what we're testing here.
  const sourceYaml = [
    '# user-authored header comment',
    'vars:',
    '  admin:',
    '    uid: 1000',
    'core:',
    '  hostname: with-comment',
    '  timezone: UTC',
    '  kernels: [linux]',
    '  ntp: true',
    'disks:',
    '  - device: /dev/vda',
    '    wipe: true',
    '    table: gpt',
    '    partitions:',
    '      - mount: /boot',
    '        fs: fat32',
    '        size: 1GiB',
    '        start: 1MiB',
    '        flags: [boot, esp]',
    '      - mount: /',
    '        fs: ext4',
    '        size: 20GiB',
    'users:',
    '  - name: spader',
    '    uid: ${admin.uid}',
    '    sudo: password',
    '    groups: [wheel]',
    '',
  ].join('\n')
  writeFileSync(join(tmp, 'bicycle.yml'), sourceYaml)

  const loc = locateConfigTree(tmp)
  applyConfigTree(loc, testMachine({ disks: { '/dev/vda': 100 * 1024 ** 3 } }))

  const src = getSource()
  expect(src!.yaml).toBe(sourceYaml)
  // The exact comment and vars table survive, even though the derived
  // ArchinstallConfig has neither.
  expect(src!.yaml).toContain('# user-authored header comment')
  expect(src!.yaml).toContain('${admin.uid}')
})
