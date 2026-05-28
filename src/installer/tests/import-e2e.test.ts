import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateConfigTree, applyConfigTree } from '../src/import-tree'
import { buildInstallSteps, type InstallStep } from '../src/install-steps'
import { getSource, clearSource, getState, getRetained } from '../src/state'
import { getAgeKey, setAgeKey } from '../src/ui-state'
import { testMachine } from '../src/config'
import { promoteUsers } from '../src/users-promote'
import { loadBicycleDoc } from '@bicycle/shared'

const EXAMPLE_ROOT = new URL('../../../example/machine', import.meta.url).pathname

// Stand in for `git clone https://... /tmp/bicycle-import-XXX`: copy the
// example tree into a /tmp directory whose name matches what the real import
// handler uses, so setSource's cleanup-on-replace would target it instead of
// the real fixture (defense in depth — also exercised by the safety rule
// in state.ts).
const stageClone = (): string => {
  const tmp = mkdtempSync(join(tmpdir(), 'bicycle-import-'))
  cpSync(EXAMPLE_ROOT, tmp, { recursive: true })
  return tmp
}

let clone: string

beforeEach(() => {
  clearSource()
  setAgeKey(null)
  clone = stageClone()
})

afterEach(() => {
  rmSync(clone, { recursive: true, force: true })
  clearSource()
  setAgeKey(null)
})

test('importing example/machine/ from a "git clone" requires zero manual intervention', async () => {
  // 1. Locate the config tree inside the freshly-cloned directory.
  const loc = locateConfigTree(clone)
  expect(loc.text).toContain('hostname: spum-cannon')
  expect(loc.ageIdentity).toBeTruthy()

  // 2. Apply it. After this, installer state is fully populated: derived
  //    ArchinstallConfig, retained Bicycle-only fields, source pointer, and
  //    in-memory age identity — without any human typing.
  applyConfigTree(loc, testMachine({ disks: { '/dev/vda': 32 * 1024 ** 3 } }), { ownsTree: true })

  const state = getState()
  const src = getSource()
  expect(state.hostname).toBe('spum-cannon')
  expect(state.kernels).toEqual(['linux'])
  expect(state.disk_config?.device_modifications[0]?.device).toBe('/dev/vda')
  expect(src?.tree).toBe(clone)
  // Source YAML is preserved byte-for-byte — preview shows what's on disk,
  // not a derive-then-re-serialize round-trip.
  expect(src?.yaml).toBe(readFileSync(join(clone, 'bicycle.yml'), 'utf8'))
  // age.key was picked up off disk automatically.
  expect(getAgeKey()).toBeTruthy()
  expect(getAgeKey()).toMatch(/^AGE-SECRET-KEY-/)

  // 3. Retained Bicycle-only fields (catalog, systemd) survive the round trip.
  expect(getRetained().catalog?.url).toBeTruthy()
  expect(getRetained().systemd?.enable?.length).toBeGreaterThan(0)

  // 3b. The YAML user is promotable with zero typing: its password secret
  //     decrypts with the auto-loaded age key and hashes for archinstall.
  const bikeUsers = loadBicycleDoc(src!.yaml).resolved.users ?? []
  expect(bikeUsers.some((u) => u.sudo !== 'none' && u.password)).toBe(true)
  const promoted = await promoteUsers(bikeUsers, clone, getAgeKey())
  expect(promoted).toHaveLength(1)
  expect(promoted[0]!.username).toBe('spader')
  expect(promoted[0]!.sudo).toBe(true)
  expect(promoted[0]!.enc_password).toMatch(/^\$6\$/)

  // 4. Run the install steps against a staged mountRoot. The whole tree
  //    must reach <mountRoot>/etc/bicycle, age.key gets its own file at
  //    mode 0600, and neither age.key nor .git ends up inside the published
  //    worktree.
  const mountRoot = mkdtempSync(join(tmpdir(), 'bicycle-mountroot-'))
  try {
    const steps: InstallStep[] = buildInstallSteps({
      source: src!,
      state,
      retained: getRetained(),
      ageKey: getAgeKey(),
      packageRepos: {},
      mountRoot,
    })
    const labels = steps.map((s) => s.label)
    const publishIdx = labels.findIndex((l) => /publish config tree/.test(l))
    const yamlIdx = labels.findIndex((l) => /bicycle\.yml$/.test(l))
    const ageIdx = labels.findIndex((l) => /age\.key$/.test(l))
    const pkgIdx = labels.findIndex((l) => /install bicycle pkg/.test(l))
    expect(publishIdx).toBeGreaterThanOrEqual(0)
    expect(yamlIdx).toBeGreaterThan(publishIdx)
    expect(ageIdx).toBeGreaterThan(yamlIdx)
    expect(pkgIdx).toBeGreaterThan(ageIdx)

    // Run all fs-kind steps (the shell-kind one is `pacman -U`, not safe to
    // run in tests).
    for (const s of steps) {
      if (s.kind === 'fs') await s.run()
    }

    const out = join(mountRoot, 'etc/bicycle')
    // bicycle.yml landed verbatim from source.
    expect(readFileSync(join(out, 'bicycle.yml'), 'utf8')).toBe(loc.text)
    // Every supporting subdir from the example survived.
    for (const sub of ['apps', 'files', 'secrets']) {
      expect(existsSync(join(out, sub))).toBe(true)
    }
    expect(existsSync(join(out, 'recipients'))).toBe(true)
    // age.key landed at the right path, mode 0600, NOT inside the published
    // worktree (we don't double-copy it from the source tree).
    const keyPath = join(out, 'age.key')
    expect(readFileSync(keyPath, 'utf8')).toBe(getAgeKey()!)
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    expect(existsSync(join(out, '.git'))).toBe(false)
  } finally {
    rmSync(mountRoot, { recursive: true, force: true })
  }
})
