import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type ImportedTree = {
  text: string
  files: Map<string, Uint8Array>
  identity: string | null
}

// Skipped at the TOP LEVEL only: bicycle.yml is held as `text`; age.key becomes
// the in-memory `identity` (never copied into the tree); .git is VCS metadata.
// A user may have legitimate nested .git/age.key inside files/ or secrets/, so
// only the root entries are filtered.
const SKIP_TOP = new Set(['bicycle.yml', 'age.key', '.git'])

const readFiles = (root: string): Map<string, Uint8Array> => {
  const files = new Map<string, Uint8Array>()
  const walk = (dir: string, prefix: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (prefix === '' && SKIP_TOP.has(ent.name)) continue
      const rel = prefix === '' ? ent.name : `${prefix}/${ent.name}`
      const abs = join(dir, ent.name)
      if (ent.isDirectory()) walk(abs, rel)
      else if (ent.isFile()) files.set(rel, new Uint8Array(readFileSync(abs)))
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
