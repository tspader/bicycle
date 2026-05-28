import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildInstallSteps, type InstallStep } from '../src/install-steps'
import { generate, recipientFor, decryptText } from '../src/age'

const TEXT = 'core:\n  hostname: box\n  timezone: UTC\n  kernels: [linux]\n  ntp: true\n'

let mountRoot: string
beforeEach(() => { mountRoot = mkdtempSync(join(tmpdir(), 'bicycle-mountroot-')) })
afterEach(() => { rmSync(mountRoot, { recursive: true, force: true }) })

const runFs = async (steps: InstallStep[]) => {
  for (const s of steps) if (s.kind === 'fs') await s.run()
}
const etc = () => join(mountRoot, 'etc/bicycle')

test('writes the whole config tree, then installs + reconciles', async () => {
  const files = new Map<string, Uint8Array>([
    ['apps/x/config.yml', new TextEncoder().encode('app: 1')],
    ['files/etc/foo.conf', new TextEncoder().encode('foo')],
    ['secrets/svc/token.age', new TextEncoder().encode('cipher')],
  ])
  const steps = buildInstallSteps({ text: TEXT, files, identity: null, mountRoot })

  const labels = steps.map((s) => s.label)
  const treeIdx = labels.findIndex((l) => /write config tree/.test(l))
  const pkgIdx = labels.findIndex((l) => /install bicycle pkg/.test(l))
  const reconcileIdx = labels.findIndex((l) => /reconcile/.test(l))
  expect(treeIdx).toBeGreaterThanOrEqual(0)
  expect(pkgIdx).toBeGreaterThan(treeIdx)
  expect(reconcileIdx).toBeGreaterThan(pkgIdx)
  expect(labels.some((l) => /age\.key/.test(l))).toBe(false)

  await runFs(steps)
  expect(readFileSync(join(etc(), 'bicycle.yml'), 'utf8')).toBe(TEXT)
  expect(readFileSync(join(etc(), 'apps/x/config.yml'), 'utf8')).toBe('app: 1')
  expect(readFileSync(join(etc(), 'files/etc/foo.conf'), 'utf8')).toBe('foo')
  expect(readFileSync(join(etc(), 'secrets/svc/token.age'), 'utf8')).toBe('cipher')
  expect(existsSync(join(etc(), 'age.key'))).toBe(false)
})

test('writes the age identity at mode 0600', async () => {
  const identity = await generate()
  const steps = buildInstallSteps({ text: TEXT, files: new Map(), identity, mountRoot })
  await runFs(steps)
  const keyPath = join(etc(), 'age.key')
  expect(readFileSync(keyPath, 'utf8')).toBe(identity)
  expect(statSync(keyPath).mode & 0o777).toBe(0o600)
})

test('encrypts staged UI secrets to the resolved recipients + writes recipients', async () => {
  const identity = await generate()
  const recipient = await recipientFor(identity)
  const steps = buildInstallSteps({
    text: TEXT,
    files: new Map(),
    identity,
    pendingSecrets: [{ addr: 'users/bob/password', clear: 'hunter2' }],
    recipients: [recipient],
    mountRoot,
  })
  await runFs(steps)
  const secretPath = join(etc(), 'secrets/users/bob/password.age')
  expect(existsSync(secretPath)).toBe(true)
  expect(statSync(secretPath).mode & 0o777).toBe(0o600)
  const clear = await decryptText(new Uint8Array(readFileSync(secretPath)), identity)
  expect(clear).toBe('hunter2')
  expect(readFileSync(join(etc(), 'recipients'), 'utf8').trim()).toBe(recipient)
})

test('does not overwrite an imported recipients file', async () => {
  const identity = await generate()
  const recipient = await recipientFor(identity)
  const files = new Map<string, Uint8Array>([
    ['recipients', new TextEncoder().encode('age1imported\n')],
  ])
  const steps = buildInstallSteps({
    text: TEXT,
    files,
    identity,
    pendingSecrets: [{ addr: 'users/bob/password', clear: 'pw' }],
    recipients: [recipient],
    mountRoot,
  })
  await runFs(steps)
  expect(readFileSync(join(etc(), 'recipients'), 'utf8')).toBe('age1imported\n')
})

test('rejects staged secrets with no recipients', async () => {
  const steps = buildInstallSteps({
    text: TEXT,
    files: new Map(),
    identity: null,
    pendingSecrets: [{ addr: 'users/bob/password', clear: 'pw' }],
    recipients: [],
    mountRoot,
  })
  await expect(runFs(steps)).rejects.toThrow(/no age recipients/)
})
