import type { BicycleConfig, Diff } from '@bicycle/shared'
import type { Host } from '@bicycle/core/host'
import { Users } from '@bicycle/core/reconcilers/users'
import { Tree } from '@bicycle/core/tree'

export namespace Groups {
  type Group = NonNullable<BicycleConfig['groups']>[number]

  type Existing = { name: string; gid: number }

  type Action =
    | { do: 'create'; group: Group }
    | { do: 'gid-mismatch'; group: Group; have: number }
    | { do: 'undeclared'; name: string; gid: number }

  const parse = (line: string): Existing => {
    const parts = line.split(':')
    return { name: parts[0] ?? '', gid: Number(parts[2]) }
  }

  const valid = (e: Existing): boolean => e.name !== '' && Number.isInteger(e.gid)

  async function everything(host: Host): Promise<Existing[]> {
    const r = await host.exec(['getent', 'group'])
    if (r.code !== 0) return []
    return r.stdout.split('\n').map(parse).filter(valid)
  }

  async function lookup(host: Host, name: string): Promise<Existing | null> {
    const r = await host.exec(['getent', 'group', name])
    if (r.code !== 0) return null
    const found = parse(r.stdout.trim())
    return Number.isInteger(found.gid) ? found : null
  }

  async function actions(host: Host): Promise<Action[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const groups = cfg.groups ?? []
    const out: Action[] = []
    for (const g of groups) {
      const existing = await lookup(host, g.name)
      if (!existing) out.push({ do: 'create', group: g })
      else if (existing.gid !== g.gid) out.push({ do: 'gid-mismatch', group: g, have: existing.gid })
    }
    const declared = new Set(groups.map((g) => g.name))
    const users = new Set((await Users.everyone(host)).map((u) => u.name))
    for (const e of await everything(host)) {
      if (e.gid < Users.HUMAN_ID_MIN || e.gid >= Users.HUMAN_ID_MAX) continue
      if (declared.has(e.name) || users.has(e.name)) continue
      out.push({ do: 'undeclared', name: e.name, gid: e.gid })
    }
    return out
  }

  function diff(a: Action): Diff {
    switch (a.do) {
      case 'create':
        return { type: 'group', id: a.group.name, field: 'exists', expected: true, actual: false }
      case 'gid-mismatch':
        return { type: 'group', id: a.group.name, field: 'gid', expected: a.group.gid, actual: a.have }
      case 'undeclared':
        return { type: 'group', id: a.name, field: 'exists', expected: null, actual: true, meta: { gid: a.gid } }
    }
  }

  export const plan = async (host: Host): Promise<Diff[]> => (await actions(host)).map(diff)

  async function create(host: Host, g: Group): Promise<void> {
    host.log.info({ group: g.name, gid: g.gid }, 'groups: creating')
    const r = await host.exec(['groupadd', '-g', String(g.gid), g.name])
    if (r.code !== 0) {
      host.log.error(
        { group: g.name, gid: g.gid, exitCode: r.code, stderr: r.stderr.trim() },
        'groups: failed to create',
      )
      return
    }
    host.log.info({ group: g.name, gid: g.gid }, 'groups: created')
  }

  export async function all(host: Host): Promise<void> {
    for (const a of await actions(host)) {
      switch (a.do) {
        case 'create':
          await create(host, a.group)
          break
        case 'gid-mismatch':
          host.log.warn(
            { group: a.group.name, wantGid: a.group.gid, haveGid: a.have },
            "groups: gid mismatch; refusing to modify live group, run 'groupmod -g <gid> <name>' manually",
          )
          break
        case 'undeclared':
          break
      }
    }
  }
}
