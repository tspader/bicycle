import { test, expect } from 'bun:test'
import { setScalar, setNode, deleteAt, append, pruneEmpty, resolved } from '../src/doc'

const SRC = `# header comment
core:
  hostname: box   # inline
  timezone: UTC
  kernels: [linux]
  ntp: true
vars:
  admin:
    uid: 1000
users:
  - name: spader
    uid: \${admin.uid}
    sudo: password
    groups: [wheel, media]
    password: \${secret:users/spader/password}
packages:
  extra: [git, vim]
`

const changedLines = (a: string, b: string): number[] => {
  const la = a.split('\n')
  const lb = b.split('\n')
  const out: number[] = []
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) out.push(i)
  return out
}

test('scalar edit changes only the target line; comments/flow/refs preserved', () => {
  const out = setScalar(SRC, ['core', 'hostname'], 'newbox')
  expect(out).toContain('hostname: newbox')
  expect(out).toContain('# header comment')
  expect(out).toContain('kernels: [linux]')
  expect(out).toContain('uid: ${admin.uid}')
  expect(out).toContain('password: ${secret:users/spader/password}')
  // Only the hostname line is touched.
  expect(changedLines(SRC, out)).toEqual([2])
})

test('setNode writes flow arrays for scalar lists', () => {
  expect(setNode(SRC, ['core', 'kernels'], ['linux', 'linux-zen']))
    .toContain('kernels: [linux, linux-zen]')
})

test('append adds to an existing flow seq', () => {
  expect(append(SRC, ['packages', 'extra'], 'lsd')).toContain('extra: [git, vim, lsd]')
})

test('append creates a new seq when the path is absent', () => {
  expect(append(SRC, ['packages', 'core'], 'base')).toMatch(/core: \[base\]/)
})

test('deleteAt + pruneEmpty removes an entry and its empty parents', () => {
  let out = deleteAt(SRC, ['packages', 'extra', 0])
  out = deleteAt(out, ['packages', 'extra', 0])
  out = pruneEmpty(out, ['packages', 'extra'])
  out = pruneEmpty(out, ['packages'])
  expect(out).not.toContain('packages:')
  expect(out).not.toContain('extra:')
})

test('field-level edit preserves a sibling var ref', () => {
  const out = setNode(SRC, ['users', 0, 'groups'], ['wheel'])
  expect(out).toContain('uid: ${admin.uid}')
  expect(out).toContain('groups: [wheel]')
})

test('resolved substitutes vars, leaves secrets literal', () => {
  const r = resolved(SRC)
  expect(r.users?.[0]?.uid).toBe(1000)
  expect(r.users?.[0]?.password).toBe('${secret:users/spader/password}')
})

test('resolved on blank text returns an empty config', () => {
  expect(resolved('')).toEqual({})
})

test('editing from empty seeds a fresh map', () => {
  expect(setScalar('', ['core', 'hostname'], 'x')).toBe('core:\n  hostname: x\n')
})
