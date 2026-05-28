import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import type { User as BicycleUser } from '@bicycle/shared'
import type { User as ArchUser } from './config'
import { decryptText } from './age'
import { hashPassword } from './auth'

const SECRET_REF = /^\$\{secret:([^}]+)\}$/

// Map a secret address ("users/spader/password") to its file inside a source
// config tree: <tree>/secrets/<addr>.age. Mirrors the daemon's
// paths.etc.secret() convention, including its escape guard — an imported
// bicycle.yml is untrusted, so a ref like ${secret:../../etc/shadow} must not
// read outside the tree's secrets/ root.
export const secretPath = (tree: string, addr: string): string => {
  const trimmed = addr.trim()
  if (!trimmed) throw new Error('empty secret address')
  if (trimmed.startsWith('/')) throw new Error(`secret address must be relative: ${addr}`)
  const secretsRoot = join(tree, 'secrets')
  const resolved = resolve(secretsRoot, `${trimmed}.age`)
  const rel = relative(secretsRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`secret address escapes secrets root: ${addr}`)
  }
  return resolved
}

export type PromoteUser = Pick<BicycleUser, 'name' | 'sudo' | 'groups' | 'password'>

/**
 * Turn Bicycle users carrying password secret refs into archinstall users
 * with a hashed `enc_password`. Decrypts each user's password secret from the
 * source tree with the in-memory age identity, then hashes the cleartext for
 * archinstall. Users without a password ref are skipped (they'll still be
 * created by the daemon on first boot, just without an install-time login).
 *
 * Throws with an actionable message if a ref is malformed, the tree/age key
 * is missing, or the secret file is absent — so the failure surfaces at
 * install start rather than producing a silently login-less machine.
 */
export const promoteUsers = async (
  users: PromoteUser[],
  tree: string | null,
  ageKey: string | null,
): Promise<ArchUser[]> => {
  const out: ArchUser[] = []
  for (const u of users) {
    if (!u.password) continue
    const m = SECRET_REF.exec(u.password.trim())
    if (!m) {
      throw new Error(`user ${u.name}: password must be a \${secret:...} reference`)
    }
    if (!tree) {
      throw new Error(`user ${u.name}: password secret requires an imported config tree`)
    }
    if (!ageKey) {
      throw new Error(`user ${u.name}: an age identity is required to decrypt the password secret`)
    }
    const path = secretPath(tree, m[1]!)
    if (!existsSync(path)) {
      throw new Error(`user ${u.name}: password secret not found at secrets/${m[1]}.age`)
    }
    let clear: string
    try {
      clear = await decryptText(new Uint8Array(readFileSync(path)), ageKey)
    } catch (e) {
      throw new Error(`user ${u.name}: failed to decrypt password secret (${(e as Error).message})`)
    }
    // Secret content is the password verbatim — no trimming, to stay
    // byte-identical with the daemon, which feeds the decrypted bytes
    // straight to chpasswd. An empty secret would silently create a
    // passwordless account, so reject it.
    if (clear.length === 0) {
      throw new Error(`user ${u.name}: password secret is empty`)
    }
    out.push({
      username: u.name,
      sudo: u.sudo !== 'none',
      groups: u.groups,
      enc_password: await hashPassword(clear),
    })
  }
  return out
}

// Merge promoted (YAML-sourced) users with UI-created users, deduping by
// username. UI-created entries win on conflict, since the user explicitly
// edited them in this session.
export const mergeUsers = (uiUsers: ArchUser[], promoted: ArchUser[]): ArchUser[] => {
  const byName = new Map<string, ArchUser>()
  for (const u of promoted) byName.set(u.username, u)
  for (const u of uiUsers) byName.set(u.username, u)
  return [...byName.values()]
}
