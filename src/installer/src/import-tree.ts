import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Mode travels with the bytes so the install lays files down with the same
// permissions a git clone of the tree would have (git tracks the exec bit, so
// in practice this is 0644 vs 0755 — scripts under files/ stay executable).
export type TreeFile = { bytes: Uint8Array; mode: number }

export type ImportedTree = {
  text: string
  files: Map<string, TreeFile>
  identity: string | null
}

// Skipped at the TOP LEVEL only: bicycle.yml is held as `text`; age.key becomes
// the in-memory `identity` (never copied into the tree); .git is VCS metadata.
// A user may have legitimate nested .git/age.key inside files/ or secrets/, so
// only the root entries are filtered.
const SKIP_TOP = new Set(['bicycle.yml', 'age.key', '.git'])

const readFiles = (root: string): Map<string, TreeFile> => {
  const files = new Map<string, TreeFile>()
  const walk = (dir: string, prefix: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (prefix === '' && SKIP_TOP.has(ent.name)) continue
      const rel = prefix === '' ? ent.name : `${prefix}/${ent.name}`
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) walk(abs, rel)
      else if (ent.isFile()) {
        files.set(rel, {
          bytes: new Uint8Array(readFileSync(abs)),
          mode: statSync(abs).mode & 0o7777,
        })
      }
    }
  }
  walk(root, '')
  return files
}

/**
 * Locate a Bicycle config tree inside a cloned/extracted directory. Looks for
 * bicycle.yml at the repo root first (the common case), then under .bicycle/
 * (legacy layout). Throws if none is found.
 */
export const locateTreeRoot = (cloneDir: string): string => {
  const candidates = [cloneDir, join(cloneDir, '.bicycle')]
  const root = candidates.find((d) => existsSync(join(d, 'bicycle.yml')))
  if (!root) throw new Error('bicycle.yml not found at repo root or .bicycle/')
  return root
}

/**
 * Read an entire config tree into memory: bicycle.yml text, the supporting file
 * map, and an adopted age identity (from age.key, if present). The caller can
 * then delete the on-disk clone immediately — nothing references it afterward.
 */
export const importTree = (treeRoot: string): ImportedTree => {
  const text = readFileSync(join(treeRoot, 'bicycle.yml'), 'utf8')

  let identity: string | null = null
  const ageKeyPath = join(treeRoot, 'age.key')
  if (existsSync(ageKeyPath)) {
    const lines = readFileSync(ageKeyPath, 'utf8').split(/\r?\n/).map((l) => l.trim())
    identity = lines.find((l) => l.startsWith('AGE-SECRET-KEY-')) ?? null
  }

  return { text, files: readFiles(treeRoot), identity }
}
