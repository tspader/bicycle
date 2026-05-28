import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromYaml, liveMachine, type MachineCtx } from './config'
import { replaceState, setRetained, setSource } from './state'
import { setAgeKey } from './ui-state'

export type LocateResult = {
  treeRoot: string
  yamlPath: string
  text: string
  /** AGE-SECRET-KEY-... line found in <treeRoot>/age.key, if any. */
  ageIdentity: string | null
}

/**
 * Locate a Bicycle config tree inside a cloned/extracted directory. Looks for
 * bicycle.yml at the repo root first (the common case), then under .bicycle/
 * (legacy layout). Also picks up an optional age.key from the same tree so
 * the caller can plumb it into installer state without a second manual step.
 *
 * Pure: no state mutation. Throws if no bicycle.yml is found.
 */
export const locateConfigTree = (cloneDir: string): LocateResult => {
  const candidates = [cloneDir, join(cloneDir, '.bicycle')]
  const treeRoot = candidates.find((d) => existsSync(join(d, 'bicycle.yml')))
  if (!treeRoot) {
    throw new Error('bicycle.yml not found at repo root or .bicycle/')
  }
  const yamlPath = join(treeRoot, 'bicycle.yml')
  const text = readFileSync(yamlPath, 'utf8')

  let ageIdentity: string | null = null
  const ageKeyPath = join(treeRoot, 'age.key')
  if (existsSync(ageKeyPath)) {
    const lines = readFileSync(ageKeyPath, 'utf8').split(/\r?\n/).map((l) => l.trim())
    ageIdentity = lines.find((l) => l.startsWith('AGE-SECRET-KEY-')) ?? null
  }

  return { treeRoot, yamlPath, text, ageIdentity }
}

/**
 * Apply a previously-located config tree to installer state. Replaces the
 * derived ArchinstallConfig + retained doc, and records the source so the
 * preview shows the original YAML and install copies the tree verbatim.
 *
 * If the tree carried an age.key, it's loaded into in-memory secrets — never
 * copied into the worktree; install writes it to /mnt/etc/bicycle/age.key
 * separately with mode 0600.
 *
 * `ownsTree` controls whether `setSource`'s cleanup-on-replace can delete
 * the tree directory. Callers that constructed the tree themselves (the
 * git-import handler, which clones into /tmp/bicycle-import-XXX) should
 * pass true; callers handing in a path the user owns (tests pointing at
 * a fixture, manual staging) should pass false.
 */
export const applyConfigTree = (
  loc: LocateResult,
  ctx: MachineCtx = liveMachine(),
  opts: { ownsTree?: boolean } = {},
): void => {
  const { config, retained } = fromYaml(loc.text, ctx)
  replaceState(config)
  setRetained(retained)
  setSource({
    yaml: loc.text,
    tree: loc.treeRoot,
    ownsTree: opts.ownsTree ?? false,
    dirty: false,
  })
  if (loc.ageIdentity) setAgeKey(loc.ageIdentity)
}
