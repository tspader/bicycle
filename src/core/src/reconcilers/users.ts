import type { BicycleConfig, Diff, SudoMode } from '@bicycle/shared'
import type { Host } from '@bicycle/core/host'
import { Interpolate } from '@bicycle/core/interpolate'
import { Secrets } from '@bicycle/core/secrets'
import { Tree } from '@bicycle/core/tree'

export namespace Users {
  type User = NonNullable<BicycleConfig['users']>[number]

  type Existing = { name: string; uid: number; gid: number; groups: string[] }

  type Action =
    | { do: 'create'; user: User; groups: string[] }
    | { do: 'uid-mismatch'; user: User; have: number }
    | { do: 'add-groups'; user: User; want: string[]; have: string[] }
    | { do: 'undeclared'; name: string; uid: number }

  export const HUMAN_ID_MIN = 1000
  export const HUMAN_ID_MAX = 60000

  async function supplementary(host: Host, name: string): Promise<string[]> {
    const r = await host.exec(['id', '-nG', name])
    if (r.code !== 0) return []
    return r.stdout.trim().split(/\s+/).filter(Boolean)
  }

  async function passwd(host: Host, name: string): Promise<Existing | null> {
    const r = await host.exec(['getent', 'passwd', name])
    if (r.code !== 0) return null
    const parts = r.stdout.trim().split(':')
    const uid = Number(parts[2])
    const gid = Number(parts[3])
    if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null
    return { name: parts[0]!, uid, gid, groups: await supplementary(host, name) }
  }

  export async function everyone(host: Host): Promise<{ name: string; uid: number }[]> {
    const r = await host.exec(['getent', 'passwd'])
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .map((line) => line.split(':'))
      .map((parts) => ({ name: parts[0] ?? '', uid: Number(parts[2]) }))
      .filter((u) => u.name !== '' && Number.isInteger(u.uid))
  }

  const wanted = (u: { sudo: SudoMode; groups: string[] }): string[] => [
    ...new Set(u.sudo !== 'none' ? [...u.groups, 'wheel'] : u.groups),
  ]

  async function actions(host: Host): Promise<Action[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const users = cfg.users ?? []
    const out: Action[] = []
    for (const u of users) {
      const existing = await passwd(host, u.name)
      if (!existing) {
        out.push({ do: 'create', user: u, groups: wanted(u) })
        continue
      }
      if (u.uid !== undefined && existing.uid !== u.uid) {
        out.push({ do: 'uid-mismatch', user: u, have: existing.uid })
      }
      const want = wanted(u)
      const have = new Set(existing.groups)
      if (want.some((g) => !have.has(g))) {
        out.push({ do: 'add-groups', user: u, want, have: existing.groups })
      }
    }
    const declared = new Set(users.map((u) => u.name))
    for (const e of await everyone(host)) {
      if (e.uid < HUMAN_ID_MIN || e.uid >= HUMAN_ID_MAX || declared.has(e.name)) continue
      out.push({ do: 'undeclared', name: e.name, uid: e.uid })
    }
    return out
  }

  function diff(a: Action): Diff {
    switch (a.do) {
      case 'create':
        return { type: 'user', id: a.user.name, field: 'exists', expected: true, actual: false }
      case 'uid-mismatch':
        return { type: 'user', id: a.user.name, field: 'uid', expected: a.user.uid!, actual: a.have }
      case 'add-groups':
        return { type: 'user', id: a.user.name, field: 'groups', expected: a.want, actual: a.have }
      case 'undeclared':
        return { type: 'user', id: a.name, field: 'exists', expected: null, actual: true, meta: { uid: a.uid } }
    }
  }

  export const plan = async (host: Host): Promise<Diff[]> => (await actions(host)).map(diff)

  async function create(host: Host, user: User, groups: string[]): Promise<boolean> {
    const args = [
      '-m',
      ...(user.uid === undefined ? [] : ['-u', String(user.uid)]),
      ...(groups.length === 0 ? [] : ['-G', groups.join(',')]),
      '--',
      user.name,
    ]
    host.log.info({ user: user.name, uid: user.uid, groups }, 'users: creating')
    const r = await host.exec(['useradd', ...args])
    if (r.code === 0) return true
    host.log.error({ user: user.name, exitCode: r.code, stderr: r.stderr.trim() }, 'users: useradd failed')
    return false
  }

  async function clear(host: Host, name: string, ref: string, vars: unknown): Promise<string | null> {
    try {
      return await Interpolate.run(ref, vars, (addr) => Secrets.read(host, addr))
    } catch (e) {
      host.log.error({ user: name, err: e }, 'users: failed to resolve password secret')
      return null
    }
  }

  async function password(host: Host, name: string, ref: string, vars: unknown): Promise<void> {
    const text = await clear(host, name, ref, vars)
    if (text === null) return
    if (text.length === 0) {
      host.log.error({ user: name }, 'users: password secret is empty; not setting password')
      return
    }
    const r = await host.exec(['chpasswd'], { stdin: `${name}:${text}\n` })
    if (r.code !== 0) {
      host.log.error({ user: name, exitCode: r.code, stderr: r.stderr.trim() }, 'users: chpasswd failed')
      return
    }
    host.log.info({ user: name }, 'users: password set')
  }

  async function join(host: Host, name: string, missing: string[]): Promise<void> {
    host.log.info({ user: name, groups: missing }, 'users: adding to groups')
    const r = await host.exec(['usermod', '-aG', missing.join(','), name])
    if (r.code !== 0) {
      host.log.error(
        { user: name, groups: missing, exitCode: r.code, stderr: r.stderr.trim() },
        'users: usermod failed',
      )
    }
  }

  export async function all(host: Host): Promise<void> {
    const vars = Tree.maybe(host)?.vars
    for (const a of await actions(host)) {
      switch (a.do) {
        case 'create': {
          const created = await create(host, a.user, a.groups)
          if (created && a.user.password) await password(host, a.user.name, a.user.password, vars)
          break
        }
        case 'uid-mismatch':
          host.log.warn(
            { user: a.user.name, wantUid: a.user.uid, haveUid: a.have },
            "users: uid mismatch; refusing to modify live user, run 'usermod -u <uid> <name>' manually",
          )
          break
        case 'add-groups': {
          const have = new Set(a.have)
          await join(
            host,
            a.user.name,
            a.want.filter((g) => !have.has(g)),
          )
          break
        }
        case 'undeclared':
          break
      }
    }
  }
}
