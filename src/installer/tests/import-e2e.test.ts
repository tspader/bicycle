import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateTreeRoot, importTree } from '../src/import-tree'
import { buildInstallSteps, type InstallStep } from '../src/install-steps'
import { loadTree, getText, getFiles, getIdentity } from '../src/state'
import { fromYaml, testMachine } from '../src/config'

const EXAMPLE_ROOT = new URL('../../../example/machine', import.meta.url).pathname

// Stand in for `git clone https://... /tmp/bicycle-import-XXX`.
const stageClone = (): string => {
  const tmp = mkdtempSync(join(tmpdir(), 'bicycle-import-'))
  cpSync(EXAMPLE_ROOT, tmp, { recursive: true })
  return tmp
}

let clone: string
beforeEach(() => { clone = stageClone() })
afterEach(() => { rmSync(clone, { recursive: true, force: true }) })

test('importing example/machine/ then installing requires zero manual intervention', async () => {
  // 1. Locate + read the tree, then delete the clone (as the real handler does).
  const root = locateTreeRoot(clone)
  const tree = importTree(root)
  const onDisk = readFileSync(join(clone, 'bicycle.yml'), 'utf8')
  loadTree(tree)
  rmSync(clone, { recursive: true, force: true })

  // 2. The config is the single source of truth: text is byte-identical to the
  //    on-disk file (comments, vars table, secret refs all intact), and it
  //    still projects to a valid archinstall config.
  expect(getText()).toBe(onDisk)
  expect(getText()).toContain('hostname: spum-cannon')
  expect(getText()).toContain('${secret:users/spader/password}')
  expect(getIdentity()).toMatch(/^AGE-SECRET-KEY-/)
  const cfg = fromYaml(getText(), testMachine({ disks: { '/dev/vda': 32 * 1024 ** 3 } }))
  expect(cfg.hostname).toBe('spum-cannon')
  expect(cfg.users).toBeUndefined() // the daemon creates users on the target

  // 3. Install: write the whole tree into a staged mountRoot.
  const mountRoot = mkdtempSync(join(tmpdir(), 'bicycle-mountroot-'))
  try {
    const steps: InstallStep[] = buildInstallSteps({
      text: getText(),
      files: getFiles(),
      identity: getIdentity(),
      mountRoot,
    })
    for (const s of steps) if (s.kind === 'fs') await s.run()

    const out = join(mountRoot, 'etc/bicycle')
    // bicycle.yml landed verbatim.
    expect(readFileSync(join(out, 'bicycle.yml'), 'utf8')).toBe(onDisk)
    // Every supporting subdir survived.
    for (const sub of ['apps', 'files', 'secrets']) {
      expect(existsSync(join(out, sub))).toBe(true)
    }
    expect(existsSync(join(out, 'recipients'))).toBe(true)
    expect(existsSync(join(out, 'secrets/users/spader/password.age'))).toBe(true)
    // age.key landed at mode 0600 and was NOT copied into the worktree.
    const keyPath = join(out, 'age.key')
    expect(readFileSync(keyPath, 'utf8')).toBe(getIdentity()!)
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    // .git never reaches the target (filtered at import time).
    expect(existsSync(join(out, '.git'))).toBe(false)
  } finally {
    rmSync(mountRoot, { recursive: true, force: true })
  }
})
