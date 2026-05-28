import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildInstallSteps, type InstallStep } from '../src/install-steps'
import { fromYaml, testMachine } from '../src/config'
import { generate, recipientFor, decryptText } from '../src/age'

const ctx = () => testMachine({ disks: { '/dev/vda': 100 * 1024 ** 3 } })

const MINIMAL = `
core:
  hostname: mark
  timezone: UTC
  kernels: [linux]
  ntp: true

disks:
  - device: /dev/vda
    wipe: true
    table: gpt
    partitions:
      - mount: /boot
        fs: fat32
        size: 1GiB
        start: 1MiB
        flags: [boot, esp]
      - mount: /
        fs: ext4
        size: rest
`

const importIt = () => fromYaml(MINIMAL, ctx())

const labels = (steps: InstallStep[]) => steps.map((s) => s.label)

const stepFor = (steps: InstallStep[], needle: RegExp): InstallStep => {
  const s = steps.find((s) => needle.test(s.label))
  if (!s) throw new Error(`no step matching ${needle}`)
  return s
}

let mountRoot: string
beforeEach(() => {
  mountRoot = mkdtempSync(join(tmpdir(), 'bicycle-mountroot-'))
})
afterEach(() => {
  rmSync(mountRoot, { recursive: true, force: true })
})

const runAllFsSteps = async (steps: InstallStep[]): Promise<void> => {
  for (const s of steps) {
    if (s.kind === 'fs') await s.run()
  }
}

describe('buildInstallSteps ordering', () => {
  test('config publish + yaml + age all precede bicycle pkg install', () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: { yaml: MINIMAL, tree: '/tmp/bicycle-import-x', ownsTree: true, dirty: false },
      state: config,
      retained,
      ageKey: 'AGE-SECRET-KEY-1' + 'A'.repeat(58),
      packageRepos: {},
    })
    const ls = labels(steps)
    const publishIdx = ls.findIndex((l) => /publish config tree/.test(l))
    const yamlIdx = ls.findIndex((l) => /bicycle\.yml/.test(l))
    const ageIdx = ls.findIndex((l) => /age\.key/.test(l))
    const pkgIdx = ls.findIndex((l) => /install bicycle pkg/.test(l))
    expect(publishIdx).toBeLessThan(yamlIdx)
    expect(yamlIdx).toBeLessThan(ageIdx)
    expect(ageIdx).toBeLessThan(pkgIdx)
  })

  test('pkg install + chroot reconcile are the shell steps (rest are fs)', () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: null, packageRepos: {},
    })
    const pkg = stepFor(steps, /install bicycle pkg/)
    const reconcile = stepFor(steps, /reconcile users\/groups/)
    expect(pkg.kind).toBe('shell')
    expect(reconcile.kind).toBe('shell')
    for (const s of steps) {
      if (s !== pkg && s !== reconcile) expect(s.kind).toBe('fs')
    }
  })

  test('chroot reconcile runs after pkg install, only the chroot-safe subset', () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: null, packageRepos: {}, mountRoot,
    })
    const ls = labels(steps)
    expect(ls.findIndex((l) => /install bicycle pkg/.test(l)))
      .toBeLessThan(ls.findIndex((l) => /reconcile users\/groups/.test(l)))
    const reconcile = stepFor(steps, /reconcile users\/groups/)
    if (reconcile.kind !== 'shell') throw new Error('expected shell step')
    expect(reconcile.argv).toEqual([
      'arch-chroot', mountRoot, 'bicycle', 'reconcile-once',
      '--only', 'groups', 'users', 'sudoers', 'dirs', 'files',
    ])
  })
})

describe('buildInstallSteps source modes', () => {
  test('no source -> writes derived bicycle.yml from state', async () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: null, packageRepos: {}, mountRoot,
    })
    await runAllFsSteps(steps)
    const written = readFileSync(join(mountRoot, 'etc/bicycle/bicycle.yml'), 'utf8')
    expect(written).toContain('hostname: mark')
  })

  test('clean source.yaml is written verbatim (comments preserved)', async () => {
    const { config, retained } = importIt()
    const yaml = '# preserved comment\n' + MINIMAL
    const steps = buildInstallSteps({
      source: { yaml, tree: null, ownsTree: false, dirty: false },
      state: config, retained, ageKey: null, packageRepos: {}, mountRoot,
    })
    await runAllFsSteps(steps)
    const written = readFileSync(join(mountRoot, 'etc/bicycle/bicycle.yml'), 'utf8')
    expect(written).toContain('# preserved comment')
  })

  test('dirty source -> derived yaml replaces source.yaml', async () => {
    const { config, retained } = importIt()
    const yaml = '# would-be-preserved-but-stale\n' + MINIMAL
    const steps = buildInstallSteps({
      source: { yaml, tree: null, ownsTree: false, dirty: true },
      state: config, retained, ageKey: null, packageRepos: {}, mountRoot,
    })
    await runAllFsSteps(steps)
    const written = readFileSync(join(mountRoot, 'etc/bicycle/bicycle.yml'), 'utf8')
    // Comment from source.yaml is dropped because state has diverged.
    expect(written).not.toContain('would-be-preserved-but-stale')
    expect(written).toContain('hostname: mark')
  })
})

describe('buildInstallSteps tree publishing', () => {
  test('copies supporting files but skips age.key, .git, bicycle.yml', async () => {
    const treeRoot = mkdtempSync(join(tmpdir(), 'bicycle-tree-'))
    try {
      writeFileSync(join(treeRoot, 'bicycle.yml'), MINIMAL)
      writeFileSync(join(treeRoot, 'age.key'), 'AGE-SECRET-KEY-1FAKE\n')
      writeFileSync(join(treeRoot, 'recipients'), 'age1abc\n')
      mkdirSync(join(treeRoot, '.git'))
      writeFileSync(join(treeRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      mkdirSync(join(treeRoot, 'apps'))
      writeFileSync(join(treeRoot, 'apps', 'config.yml'), 'foo: bar\n')
      mkdirSync(join(treeRoot, 'files'))
      writeFileSync(join(treeRoot, 'files', 'authorized_keys'), 'ssh-ed25519 abc\n')
      mkdirSync(join(treeRoot, 'secrets'))
      writeFileSync(join(treeRoot, 'secrets', 's.age'), '-----BEGIN AGE-----\n')

      const { config, retained } = importIt()
      const steps = buildInstallSteps({
        source: { yaml: MINIMAL, tree: treeRoot, ownsTree: true, dirty: false },
        state: config, retained, ageKey: null, packageRepos: {}, mountRoot,
      })
      await runAllFsSteps(steps)

      const out = join(mountRoot, 'etc/bicycle')
      expect(readFileSync(join(out, 'bicycle.yml'), 'utf8')).toBe(MINIMAL)
      expect(readFileSync(join(out, 'recipients'), 'utf8')).toBe('age1abc\n')
      expect(readFileSync(join(out, 'apps/config.yml'), 'utf8')).toBe('foo: bar\n')
      expect(readFileSync(join(out, 'files/authorized_keys'), 'utf8')).toBe('ssh-ed25519 abc\n')
      expect(readFileSync(join(out, 'secrets/s.age'), 'utf8')).toBe('-----BEGIN AGE-----\n')
      // Sensitive: age.key and .git must NOT land in the published tree.
      expect(existsSync(join(out, 'age.key'))).toBe(false)
      expect(existsSync(join(out, '.git'))).toBe(false)
    } finally {
      rmSync(treeRoot, { recursive: true, force: true })
    }
  })

  test('age.key with non-null identity lands at /etc/bicycle/age.key mode 0600', async () => {
    const ageKey = 'AGE-SECRET-KEY-1' + 'Z'.repeat(58)
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey, packageRepos: {}, mountRoot,
    })
    await runAllFsSteps(steps)
    const keyPath = join(mountRoot, 'etc/bicycle/age.key')
    expect(readFileSync(keyPath, 'utf8')).toBe(ageKey)
    const mode = statSync(keyPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('no age.key step when ageKey is null', () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: null, packageRepos: {},
    })
    expect(steps.find((s) => /age\.key/.test(s.label))).toBeUndefined()
  })
})

describe('buildInstallSteps user password secrets', () => {
  test('encrypts each clear to secrets/users/<name>/password.age + recipients file', async () => {
    const identity = await generate()
    const recipient = await recipientFor(identity)
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: identity, packageRepos: {},
      userSecrets: [{ name: 'spader', clear: 'hunter2' }],
      recipients: [recipient],
      mountRoot,
    })
    await runAllFsSteps(steps)

    const etc = join(mountRoot, 'etc/bicycle')
    const secretPath = join(etc, 'secrets/users/spader/password.age')
    expect(existsSync(secretPath)).toBe(true)
    // The persisted secret is decryptable by the matching identity and holds
    // the verbatim cleartext.
    const clear = await decryptText(new Uint8Array(readFileSync(secretPath)), identity)
    expect(clear).toBe('hunter2')
    // mode 0600 — never world-readable.
    expect(statSync(secretPath).mode & 0o777).toBe(0o600)
    // The recipients file is published so the daemon can encrypt new secrets.
    expect(readFileSync(join(etc, 'recipients'), 'utf8').trim()).toBe(recipient)
  })

  test('no secret step when userSecrets is empty', () => {
    const { config, retained } = importIt()
    const steps = buildInstallSteps({
      source: null, state: config, retained, ageKey: null, packageRepos: {},
      userSecrets: [], recipients: [],
    })
    expect(steps.find((s) => /password secret/.test(s.label))).toBeUndefined()
  })

  test('does not overwrite a recipients file the imported tree already carries', async () => {
    const treeRoot = mkdtempSync(join(tmpdir(), 'bicycle-tree-recip-'))
    try {
      writeFileSync(join(treeRoot, 'bicycle.yml'), MINIMAL)
      writeFileSync(join(treeRoot, 'recipients'), 'age1treerecipient\n')
      const identity = await generate()
      const recipient = await recipientFor(identity)
      const { config, retained } = importIt()
      const steps = buildInstallSteps({
        source: { yaml: MINIMAL, tree: treeRoot, ownsTree: true, dirty: true },
        state: config, retained, ageKey: identity, packageRepos: {},
        userSecrets: [{ name: 'spader', clear: 'pw' }],
        recipients: [recipient],
        mountRoot,
      })
      await runAllFsSteps(steps)
      // Tree's recipients (copied verbatim in step 1) must survive — the secret
      // step must not clobber it with the in-memory identity's recipient.
      expect(readFileSync(join(mountRoot, 'etc/bicycle/recipients'), 'utf8')).toBe('age1treerecipient\n')
    } finally {
      rmSync(treeRoot, { recursive: true, force: true })
    }
  })
})
