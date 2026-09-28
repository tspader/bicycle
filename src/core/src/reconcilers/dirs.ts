import type { BicycleConfig, Diff } from '@bicycle/shared'
import type { Claims } from '@bicycle/core/detect/claims'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Nss } from '@bicycle/core/nss'
import { Tree } from '@bicycle/core/tree'

export namespace Dirs {
  type Dir = NonNullable<BicycleConfig['dirs']>[number]

  type Fix = {
    owner?: { want: number; have: number }
    group?: { want: number; have: number }
    mode?: { have: number }
  }

  type Action = { do: 'create'; dir: Dir } | { do: 'fix'; dir: Dir; fix: Fix; st: Disk.Stat }

  async function owner(host: Host, d: Dir): Promise<number | null> {
    if (!d.owner) return null
    const uid = await Nss.uid(host, d.owner)
    if (uid === null) host.log.warn({ path: d.path, owner: d.owner }, 'dirs: owner unknown; skipping chown')
    return uid
  }

  async function group(host: Host, d: Dir): Promise<number | null> {
    if (!d.group) return null
    const gid = await Nss.gid(host, d.group)
    if (gid === null) host.log.warn({ path: d.path, group: d.group }, 'dirs: group unknown; skipping chgrp')
    return gid
  }

  async function actions(host: Host): Promise<Action[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const out: Action[] = []
    for (const d of cfg.dirs ?? []) {
      const st = host.disk.stat(host.paths.host(d.path))
      if (st === null) {
        out.push({ do: 'create', dir: d })
        continue
      }
      const fix: Fix = {}
      const uid = await owner(host, d)
      if (uid !== null && uid !== st.uid) fix.owner = { want: uid, have: st.uid }
      const gid = await group(host, d)
      if (gid !== null && gid !== st.gid) fix.group = { want: gid, have: st.gid }
      if (d.mode !== undefined && st.mode !== parseInt(d.mode, 8)) fix.mode = { have: st.mode }
      if (fix.owner || fix.group || fix.mode) out.push({ do: 'fix', dir: d, fix, st })
    }
    return out
  }

  function diffs(a: Action): Diff[] {
    if (a.do === 'create') {
      return [{ type: 'dir', id: a.dir.path, field: 'exists', expected: true, actual: false }]
    }
    const { path: id } = a.dir
    const { owner, group, mode } = a.fix
    return [
      ...(owner ? [{ type: 'dir', id, field: 'owner', expected: owner.want, actual: owner.have }] : []),
      ...(group ? [{ type: 'dir', id, field: 'group', expected: group.want, actual: group.have }] : []),
      ...(mode ? [{ type: 'dir', id, field: 'mode', expected: a.dir.mode!, actual: Disk.octal(mode.have) }] : []),
    ]
  }

  export const plan = async (host: Host): Promise<Diff[]> => (await actions(host)).flatMap(diffs)

  function refused(host: Host, dest: string, uid: number, gid: number): unknown {
    try {
      return host.disk.chown(dest, uid, gid) ? null : 'not permitted'
    } catch (e) {
      return e
    }
  }

  function chown(host: Host, d: Dir, dest: string, uid: number, gid: number): void {
    const err = refused(host, dest, uid, gid)
    if (err === null) host.log.info({ path: d.path, uid, gid }, 'dirs: chowned')
    else host.log.error({ err, path: d.path }, 'dirs: chown failed')
  }

  function chmod(host: Host, d: Dir, dest: string, mode: number): void {
    try {
      host.disk.chmod(dest, mode)
      host.log.info({ path: d.path, mode: d.mode }, 'dirs: chmoded')
    } catch (e) {
      host.log.error({ err: e, path: d.path }, 'dirs: chmod failed')
    }
  }

  function made(host: Host, d: Dir, dest: string): Disk.Stat | null {
    try {
      host.disk.mkdir(dest)
      host.log.info({ path: d.path, dest }, 'dirs: created')
      return host.disk.stat(dest)
    } catch (e) {
      host.log.error({ err: e, path: d.path, dest }, 'dirs: mkdir failed')
      return null
    }
  }

  async function create(host: Host, d: Dir): Promise<void> {
    const dest = host.paths.host(d.path)
    const st = made(host, d, dest)
    if (st === null) return
    const uid = await owner(host, d)
    const gid = await group(host, d)
    if (uid !== null || gid !== null) chown(host, d, dest, uid ?? st.uid, gid ?? st.gid)
    if (d.mode !== undefined) chmod(host, d, dest, parseInt(d.mode, 8))
  }

  function fix(host: Host, a: Extract<Action, { do: 'fix' }>): void {
    const dest = host.paths.host(a.dir.path)
    if (a.fix.owner || a.fix.group) {
      chown(host, a.dir, dest, a.fix.owner?.want ?? a.st.uid, a.fix.group?.want ?? a.st.gid)
    }
    if (a.fix.mode) chmod(host, a.dir, dest, parseInt(a.dir.mode!, 8))
  }

  export async function all(host: Host): Promise<void> {
    for (const a of await actions(host)) {
      if (a.do === 'create') await create(host, a.dir)
      else fix(host, a)
    }
  }

  export const claims = (host: Host): Claims => ({
    exact: [],
    prefixes: (Tree.maybe(host)?.dirs ?? []).map((d) => d.path),
  })
}
