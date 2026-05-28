import { test, expect, describe } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promoteUsers, mergeUsers, secretPath } from '../src/users-promote'
import { encrypt } from '../src/age'

// A throwaway age identity + its recipient, generated once for these tests.
// (age-keygen output; the public key is derived deterministically.)
const IDENTITY = 'AGE-SECRET-KEY-1TX34KP6WW6UW4ZCEDUUUR0C3MNE7WYLYFU6K32EPXJ9VFXEXV7ESF3XMW8'
const RECIPIENT = 'age16t9kc8dk2jd8mwfjx6j0hgrlr9kvrk7m08auvcnu8kyyszvc0psswnfx5c'

const stageSecret = async (clear: string): Promise<{ tree: string; addr: string }> => {
  const tree = mkdtempSync(join(tmpdir(), 'bicycle-promote-'))
  const addr = 'users/spader/password'
  const path = secretPath(tree, addr)
  mkdirSync(join(tree, 'secrets', 'users', 'spader'), { recursive: true })
  writeFileSync(path, await encrypt(clear, [RECIPIENT]))
  return { tree, addr }
}

describe('secretPath escape guard', () => {
  test('rejects traversal + absolute addresses', () => {
    expect(() => secretPath('/tmp/tree', '../../etc/shadow')).toThrow(/escapes/)
    expect(() => secretPath('/tmp/tree', '/etc/shadow')).toThrow(/must be relative/)
    expect(() => secretPath('/tmp/tree', '')).toThrow(/empty/)
    expect(secretPath('/tmp/tree', 'users/s/password')).toBe('/tmp/tree/secrets/users/s/password.age')
  })
})

describe('promoteUsers', () => {
  test('decrypts password secret and hashes it for archinstall', async () => {
    const { tree } = await stageSecret('hunter2')
    try {
      const out = await promoteUsers(
        [{ name: 'spader', sudo: 'password', groups: ['wheel', 'media'], password: '${secret:users/spader/password}' }],
        tree,
        IDENTITY,
      )
      expect(out).toHaveLength(1)
      expect(out[0]!.username).toBe('spader')
      expect(out[0]!.sudo).toBe(true)
      expect(out[0]!.groups).toEqual(['wheel', 'media'])
      // sha512crypt hash, not the cleartext.
      expect(out[0]!.enc_password).toMatch(/^\$6\$/)
      expect(out[0]!.enc_password).not.toContain('hunter2')
    } finally {
      rmSync(tree, { recursive: true, force: true })
    }
  })

  test('skips users without a password ref', async () => {
    const out = await promoteUsers(
      [{ name: 'nobody', sudo: 'none', groups: [], password: undefined }],
      '/tmp/whatever',
      IDENTITY,
    )
    expect(out).toEqual([])
  })

  test('throws a clear error when age key is missing', async () => {
    const { tree } = await stageSecret('x')
    try {
      await expect(promoteUsers(
        [{ name: 'spader', sudo: 'password', groups: [], password: '${secret:users/spader/password}' }],
        tree,
        null,
      )).rejects.toThrow(/age identity is required/)
    } finally {
      rmSync(tree, { recursive: true, force: true })
    }
  })

  test('throws when the secret file is absent', async () => {
    const tree = mkdtempSync(join(tmpdir(), 'bicycle-promote-empty-'))
    try {
      await expect(promoteUsers(
        [{ name: 'spader', sudo: 'password', groups: [], password: '${secret:users/spader/password}' }],
        tree,
        IDENTITY,
      )).rejects.toThrow(/not found/)
    } finally {
      rmSync(tree, { recursive: true, force: true })
    }
  })

  test('throws on a malformed (non-secret) ref', async () => {
    await expect(promoteUsers(
      [{ name: 'spader', sudo: 'password', groups: [], password: 'plaintextoops' }],
      '/tmp/x',
      IDENTITY,
    )).rejects.toThrow(/must be a .*secret/)
  })
})

describe('mergeUsers', () => {
  const arch = (username: string) => ({ username, sudo: true, groups: [], enc_password: 'h' })
  test('UI users win over promoted on name conflict', () => {
    const merged = mergeUsers([arch('spader')], [{ ...arch('spader'), enc_password: 'promoted' }])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.enc_password).toBe('h')
  })
  test('union of distinct names', () => {
    const merged = mergeUsers([arch('a')], [arch('b')])
    expect(merged.map((u) => u.username).sort()).toEqual(['a', 'b'])
  })
})
