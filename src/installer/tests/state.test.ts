import { test, expect } from 'bun:test'
import {
  getText, getConfig, getFiles, getIdentity, getPendingSecrets,
  loadTree, editScalar, editAppend, editDelete,
  stageSecret, unstageSecret, setIdentity,
} from '../src/state'

const FAKE_AGE = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)

test('a fresh config starts from a valid default', () => {
  const c = getConfig()
  expect(c.core?.hostname).toBe('bicycle')
  expect(c.core?.kernels).toEqual(['linux'])
  expect(c.locale?.keyboard).toBe('us')
})

test('editScalar mutates the text and is reflected in the parsed config', () => {
  editScalar(['core', 'hostname'], 'edited-host')
  expect(getText()).toContain('hostname: edited-host')
  expect(getConfig().core?.hostname).toBe('edited-host')
})

test('editAppend / editDelete operate on seqs', () => {
  editAppend(['users'], { name: 'a', sudo: 'none', groups: ['wheel'] })
  expect(getConfig().users?.[0]?.name).toBe('a')
  editDelete(['users', 0])
  expect(getConfig().users ?? []).toEqual([])
})

test('staged secrets are tracked and clearable', () => {
  stageSecret('users/a/password', 'pw')
  expect(getPendingSecrets().get('users/a/password')).toBe('pw')
  unstageSecret('users/a/password')
  expect(getPendingSecrets().has('users/a/password')).toBe(false)
})

test('loadTree replaces text/files/identity and clears staged secrets', () => {
  stageSecret('x/y', 'z')
  setIdentity(null)
  const files = new Map<string, Uint8Array>([['recipients', new TextEncoder().encode('age1x\n')]])
  loadTree({ text: 'core:\n  hostname: imported\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n', files, identity: FAKE_AGE })
  expect(getConfig().core?.hostname).toBe('imported')
  expect(getFiles().has('recipients')).toBe(true)
  expect(getIdentity()).toBe(FAKE_AGE)
  expect(getPendingSecrets().has('x/y')).toBe(false)
})
