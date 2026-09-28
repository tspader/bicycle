import crypto from 'crypto'
import path from 'path'
import { FileDescriptor, type Diff } from '@bicycle/shared'
import { Age } from '@bicycle/core/age'
import type { Claims } from '@bicycle/core/detect/claims'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Nss } from '@bicycle/core/nss'
import type { Paths } from '@bicycle/core/paths'
import { Secrets } from '@bicycle/core/secrets'
import { Template } from '@bicycle/core/template'
import { Tree } from '@bicycle/core/tree'

export namespace Files {
  type FileEntry = {
    kind: 'file'
    target: string
    source: string
    encrypted: boolean
    template: boolean
    mode?: number
    owner?: string
    group?: string
  }
  type SymlinkEntry = {
    kind: 'symlink'
    target: string
    to: string
    owner?: string
    group?: string
  }
  type Entry = FileEntry | SymlinkEntry

  type Plan = { entries: Entry[]; errored: boolean }

  type Own = { uid: number; gid: number }

  const sha = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex')

  function parseSuffixes(rel: string): { stripped: string; encrypted: boolean; template: boolean } {
    const encrypted = rel.endsWith('.age')
    const opened = encrypted ? rel.slice(0, -'.age'.length) : rel
    const template = opened.endsWith('.tpl')
    const stripped = template ? opened.slice(0, -'.tpl'.length) : opened
    if (template && stripped.endsWith('.age')) {
      throw new Error(`${rel}: .age.tpl is not supported; use .tpl.age (decrypt, then render)`)
    }
    return { stripped, encrypted, template }
  }

  function resolveFrom(host: Host, from: string): string {
    const abs = path.resolve(host.paths.etc.files, from)
    const rel = path.relative(host.paths.etc.files, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`from escapes files/: ${from}`)
    if (abs.endsWith('.bicycle')) throw new Error(`from may not reference a descriptor: ${from}`)
    if (host.disk.stat(abs)?.kind !== 'file') throw new Error(`from does not exist: ${from}`)
    return abs
  }

  const SIBLING_SUFFIXES = [
    { suffix: '', encrypted: false, template: false },
    { suffix: '.tpl', encrypted: false, template: true },
    { suffix: '.age', encrypted: true, template: false },
    { suffix: '.tpl.age', encrypted: true, template: true },
  ] as const

  const siblingCandidates = (paths: Paths, target: string) =>
    SIBLING_SUFFIXES.map((s) => ({
      ...s,
      abs: path.join(paths.etc.files, target + s.suffix),
    }))

  type Content = { source: string; encrypted: boolean; template: boolean; consumed: string | null }

  function content(host: Host, target: string, from: string | undefined): Content {
    const siblings = siblingCandidates(host.paths, target).filter((c) => host.disk.stat(c.abs)?.kind === 'file')
    if (from !== undefined) {
      if (siblings.length > 0) {
        throw new Error(`${target}: both from: and sibling content exist (${siblings.map((s) => s.abs).join(', ')})`)
      }
      const suffixes = parseSuffixes(from)
      return {
        source: resolveFrom(host, from),
        encrypted: suffixes.encrypted,
        template: suffixes.template,
        consumed: null,
      }
    }
    if (siblings.length === 0) throw new Error(`${target}: no from: and no sibling content file`)
    if (siblings.length > 1) {
      throw new Error(`${target}: ambiguous sibling content: ${siblings.map((s) => s.abs).join(', ')}`)
    }
    const s = siblings[0]!
    return { source: s.abs, encrypted: s.encrypted, template: s.template, consumed: s.abs }
  }

  function planDescriptor(host: Host, src: string, target: string): { entry: Entry; consumed: string | null } {
    const d = FileDescriptor.parse(Bun.YAML.parse(Disk.text(host.disk, src)))
    if (d.kind === 'symlink') {
      return {
        entry: { kind: 'symlink', target, to: d.to!, owner: d.owner, group: d.group },
        consumed: null,
      }
    }
    const c = content(host, target, d.from)
    return {
      entry: {
        kind: 'file',
        target,
        source: c.source,
        encrypted: c.encrypted,
        template: d.template ?? c.template,
        mode: d.mode !== undefined ? parseInt(d.mode, 8) : undefined,
        owner: d.owner,
        group: d.group,
      },
      consumed: c.consumed,
    }
  }

  function buildPlan(host: Host): Plan {
    const { paths } = host
    const root = paths.etc.files
    const state = { errored: false }
    const claimed = new Map<string, { entry: Entry; src: string }[]>()
    const claim = (entry: Entry, src: string): void => {
      claimed.set(entry.target, [...(claimed.get(entry.target) ?? []), { entry, src }])
    }

    const all = Disk.walk(host.disk, root).sort()
    const consumed = new Set<string>()
    for (const src of all.filter((p) => p.endsWith('.bicycle'))) {
      const target = path.relative(root, src).slice(0, -'.bicycle'.length)
      try {
        const planned = planDescriptor(host, src, target)
        claim(planned.entry, src)
        if (planned.consumed) consumed.add(planned.consumed)
      } catch (e) {
        host.log.error({ err: e, src }, 'files: bad descriptor; skipped')
        state.errored = true
        for (const c of siblingCandidates(paths, target)) consumed.add(c.abs)
      }
    }

    for (const src of all.filter((p) => !p.endsWith('.bicycle'))) {
      if (consumed.has(src)) continue
      try {
        const { stripped, encrypted, template } = parseSuffixes(path.relative(root, src))
        claim({ kind: 'file', target: stripped, source: src, encrypted, template }, src)
      } catch (e) {
        host.log.error({ err: e, src }, 'files: bad entry; skipped')
        state.errored = true
      }
    }

    const entries: Entry[] = []
    for (const [target, list] of claimed) {
      if (list.length > 1) {
        host.log.error(
          { target, sources: list.map((c) => c.src) },
          'files: conflicting sources for one target; all skipped',
        )
        state.errored = true
        continue
      }
      entries.push(list[0]!.entry)
    }
    entries.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
    return { entries, errored: state.errored }
  }

  function writeAtomic(host: Host, dest: string, bytes: Uint8Array, mode: number, own: Own | null): void {
    const { disk } = host
    const parent = path.dirname(dest)
    Disk.nest(disk, parent)
    const st = Disk.known(parent, disk.stat(parent))
    const tmp = `${dest}.bicycle.tmp`
    disk.write(tmp, bytes, mode)
    try {
      disk.chmod(tmp, mode)
      disk.chown(tmp, own?.uid ?? st.uid, own?.gid ?? st.gid)
    } catch (e) {
      disk.remove(tmp)
      throw e
    }
    disk.rename(tmp, dest)
  }

  async function resolveOwnership(host: Host, entry: Entry): Promise<Own | null> {
    if (!entry.owner && !entry.group) return null
    const uid = entry.owner ? await Nss.uid(host, entry.owner) : null
    const gid = entry.group ? await Nss.gid(host, entry.group) : null
    if (entry.owner && uid === null) {
      host.log.warn({ target: entry.target, owner: entry.owner }, 'files: owner unknown; skipping chown')
    }
    if (entry.group && gid === null) {
      host.log.warn({ target: entry.target, group: entry.group }, 'files: group unknown; skipping chgrp')
    }
    if (uid === null && gid === null) return null
    return { uid: uid ?? -1, gid: gid ?? -1 }
  }

  function fixOwnership(host: Host, dest: string, st: Disk.Stat, want: Own): void {
    const uid = want.uid === -1 ? st.uid : want.uid
    const gid = want.gid === -1 ? st.gid : want.gid
    if (uid === st.uid && gid === st.gid) return
    if (host.disk.chown(dest, uid, gid)) host.log.info({ dest, uid, gid }, 'files: fixed ownership')
  }

  async function loadContent(
    host: Host,
    entry: FileEntry,
    vars: unknown,
  ): Promise<{ bytes: Uint8Array; secret: boolean }> {
    const bytes = entry.encrypted
      ? await Age.decrypt(host.disk, host.paths.key, entry.source)
      : host.disk.read(entry.source)
    if (!entry.template) return { bytes, secret: false }
    const r = await Template.render(new TextDecoder('utf-8', { fatal: true }).decode(bytes), vars, (addr) =>
      Secrets.read(host, addr),
    )
    return { bytes: new TextEncoder().encode(r.text), secret: r.secret }
  }

  function modeFor(host: Host, entry: FileEntry, secret: boolean): number {
    if (entry.mode !== undefined) return entry.mode
    const { mode } = Disk.known(entry.source, host.disk.stat(entry.source))
    if (!entry.encrypted && !secret) return mode
    if (secret && mode & 0o111) {
      host.log.warn(
        { target: entry.target },
        'files: template uses a secret; forcing 0600 and dropping the executable bit (set mode in a .bicycle descriptor to override)',
      )
    }
    return 0o600
  }

  type DesiredFile = {
    bytes: Uint8Array
    mode: number
    own: Own | null
    redacted: boolean
  }

  async function desiredFile(host: Host, entry: FileEntry, vars: unknown): Promise<DesiredFile> {
    const { bytes, secret } = await loadContent(host, entry, vars)
    return {
      bytes,
      mode: modeFor(host, entry, secret),
      own: await resolveOwnership(host, entry),
      redacted: entry.encrypted || secret,
    }
  }

  type Delta<T> = { want: T; have: T }

  type FileCmp =
    | { state: 'missing' }
    | { state: 'wrong-kind'; actual: string }
    | {
        state: 'present'
        st: Disk.Stat
        content: Delta<string> | null
        mode: Delta<number> | null
        owner: Delta<number> | null
        group: Delta<number> | null
      }

  function compareFile(host: Host, entry: FileEntry, desired: DesiredFile): FileCmp {
    const dest = host.paths.host(entry.target)
    const st = host.disk.lstat(dest)
    if (!st) return { state: 'missing' }
    if (st.kind !== 'file') return { state: 'wrong-kind', actual: st.kind }
    const want = sha(desired.bytes)
    const have = sha(host.disk.read(dest))
    const { mode } = st
    const own = desired.own
    return {
      state: 'present',
      st,
      content: want !== have ? { want, have } : null,
      mode: mode !== desired.mode ? { want: desired.mode, have: mode } : null,
      owner: own && own.uid !== -1 && own.uid !== st.uid ? { want: own.uid, have: st.uid } : null,
      group: own && own.gid !== -1 && own.gid !== st.gid ? { want: own.gid, have: st.gid } : null,
    }
  }

  function fileDiffs(entry: FileEntry, desired: DesiredFile, cmp: FileCmp): Diff[] {
    if (cmp.state === 'missing') {
      return [{ type: 'file', id: entry.target, field: 'exists', expected: true, actual: false }]
    }
    if (cmp.state === 'wrong-kind') {
      return [{ type: 'file', id: entry.target, field: 'kind', expected: 'file', actual: cmp.actual }]
    }
    const diffs: Diff[] = []
    if (cmp.content) {
      diffs.push({
        type: 'file',
        id: entry.target,
        field: 'content',
        expected: cmp.content.want,
        actual: cmp.content.have,
        ...(desired.redacted ? { redacted: true } : {}),
      })
    }
    if (cmp.mode) {
      diffs.push({
        type: 'file',
        id: entry.target,
        field: 'mode',
        expected: Disk.octal(cmp.mode.want),
        actual: Disk.octal(cmp.mode.have),
      })
    }
    if (cmp.owner) {
      diffs.push({
        type: 'file',
        id: entry.target,
        field: 'owner',
        expected: cmp.owner.want,
        actual: cmp.owner.have,
      })
    }
    if (cmp.group) {
      diffs.push({
        type: 'file',
        id: entry.target,
        field: 'group',
        expected: cmp.group.want,
        actual: cmp.group.have,
      })
    }
    return diffs
  }

  async function applyFile(host: Host, entry: FileEntry, vars: unknown): Promise<void> {
    const dest = host.paths.host(entry.target)
    const desired = await desiredFile(host, entry, vars)
    const cmp = compareFile(host, entry, desired)
    const own = desired.own
    if (cmp.state !== 'present' || cmp.content) {
      writeAtomic(host, dest, desired.bytes, desired.mode, own && own.uid !== -1 && own.gid !== -1 ? own : null)
      if (own) fixOwnership(host, dest, Disk.known(dest, host.disk.lstat(dest)), own)
      host.log.info({ src: entry.source, dest }, 'files: wrote')
      return
    }
    if (cmp.mode) {
      host.disk.chmod(dest, desired.mode)
      host.log.info({ dest, mode: desired.mode.toString(8) }, 'files: fixed mode')
    }
    if (own && (cmp.owner || cmp.group)) fixOwnership(host, dest, cmp.st, own)
  }

  type LinkCmp =
    | { state: 'missing' }
    | { state: 'wrong-kind'; actual: string }
    | {
        state: 'present'
        st: Disk.Stat
        target: Delta<string> | null
        owner: Delta<number> | null
        group: Delta<number> | null
      }

  function compareSymlink(host: Host, entry: SymlinkEntry, own: Own | null): LinkCmp {
    const dest = host.paths.host(entry.target)
    const st = host.disk.lstat(dest)
    if (!st) return { state: 'missing' }
    if (st.kind !== 'symlink') return { state: 'wrong-kind', actual: st.kind }
    const have = host.disk.readlink(dest)
    return {
      state: 'present',
      st,
      target: have !== entry.to ? { want: entry.to, have } : null,
      owner: own && own.uid !== -1 && own.uid !== st.uid ? { want: own.uid, have: st.uid } : null,
      group: own && own.gid !== -1 && own.gid !== st.gid ? { want: own.gid, have: st.gid } : null,
    }
  }

  function linkDiffs(entry: SymlinkEntry, cmp: LinkCmp): Diff[] {
    if (cmp.state === 'missing') {
      return [{ type: 'symlink', id: entry.target, field: 'exists', expected: true, actual: false }]
    }
    if (cmp.state === 'wrong-kind') {
      return [{ type: 'symlink', id: entry.target, field: 'kind', expected: 'symlink', actual: cmp.actual }]
    }
    const diffs: Diff[] = []
    if (cmp.target) {
      diffs.push({
        type: 'symlink',
        id: entry.target,
        field: 'target',
        expected: cmp.target.want,
        actual: cmp.target.have,
      })
    }
    if (cmp.owner) {
      diffs.push({
        type: 'symlink',
        id: entry.target,
        field: 'owner',
        expected: cmp.owner.want,
        actual: cmp.owner.have,
      })
    }
    if (cmp.group) {
      diffs.push({
        type: 'symlink',
        id: entry.target,
        field: 'group',
        expected: cmp.group.want,
        actual: cmp.group.have,
      })
    }
    return diffs
  }

  async function applySymlink(host: Host, entry: SymlinkEntry): Promise<void> {
    const dest = host.paths.host(entry.target)
    const own = await resolveOwnership(host, entry)
    const { disk } = host
    const cmp = compareSymlink(host, entry, own)
    if (cmp.state === 'present' && !cmp.target) {
      if (cmp.owner || cmp.group) {
        disk.lchown(dest, cmp.owner?.want ?? cmp.st.uid, cmp.group?.want ?? cmp.st.gid)
      }
      return
    }
    Disk.nest(disk, path.dirname(dest))
    const tmp = `${dest}.bicycle.tmp`
    disk.remove(tmp)
    disk.symlink(entry.to, tmp)
    try {
      if (own) disk.lchown(tmp, own.uid, own.gid)
      disk.rename(tmp, dest)
    } catch (e) {
      disk.remove(tmp)
      throw e
    }
    host.log.info({ dest, to: entry.to }, 'files: linked')
  }

  function removeTarget(host: Host, target: string): void {
    const dest = host.paths.host(target)
    const st = host.disk.lstat(dest)
    if (!st) return
    if (st.kind === 'dir') {
      host.log.warn({ dest }, 'files: stale target is a directory; not removing')
      return
    }
    try {
      host.disk.remove(dest)
      host.log.info({ dest }, 'files: removed (no longer declared)')
    } catch (e) {
      host.log.error({ err: e, dest }, 'files: remove failed')
    }
  }

  function parseWritten(host: Host, file: string): unknown {
    try {
      return JSON.parse(Disk.text(host.disk, file))
    } catch {
      return null
    }
  }

  function written(host: Host): string[] {
    const file = host.paths.state.written
    if (!Disk.exists(host.disk, file)) return []
    const parsed = parseWritten(host, file)
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) return parsed
    host.log.warn({ file }, 'files: unreadable manifest; previously managed targets forgotten')
    return []
  }

  function remember(host: Host, targets: string[]): void {
    host.disk.mkdir(path.dirname(host.paths.state.written))
    Disk.replace(host.disk, host.paths.state.written, JSON.stringify([...targets].sort(), null, 2) + '\n')
  }

  function reconcileManifest(host: Host, plan: Plan): void {
    const prev = written(host)
    const current = new Set(plan.entries.map((e) => e.target))
    if (plan.errored) {
      remember(host, [...new Set([...prev, ...current])])
      return
    }
    for (const t of prev) {
      if (!current.has(t)) removeTarget(host, t)
    }
    remember(host, [...current])
  }

  function loadPlan(host: Host): { plan: Plan; vars: unknown } {
    const plan = buildPlan(host)
    if (!plan.entries.some((e) => e.kind === 'file' && e.template)) return { plan, vars: {} }
    try {
      return { plan, vars: Tree.bicycle(host).vars ?? {} }
    } catch (e) {
      host.log.error({ err: e }, 'files: cannot load vars; skipping templated entries')
      return {
        plan: { errored: true, entries: plan.entries.filter((e) => !(e.kind === 'file' && e.template)) },
        vars: {},
      }
    }
  }

  async function entryDiffs(host: Host, entry: Entry, vars: unknown): Promise<Diff[]> {
    if (entry.kind === 'file') {
      const desired = await desiredFile(host, entry, vars)
      return fileDiffs(entry, desired, compareFile(host, entry, desired))
    }
    return linkDiffs(entry, compareSymlink(host, entry, await resolveOwnership(host, entry)))
  }

  export async function plan(host: Host): Promise<Diff[]> {
    if (!Disk.exists(host.disk, host.paths.etc.files)) return []
    const { plan: p, vars } = loadPlan(host)
    const diffs: Diff[] = []
    for (const entry of p.entries) {
      try {
        diffs.push(...(await entryDiffs(host, entry, vars)))
      } catch (e) {
        host.log.error({ err: e, target: entry.target }, 'files: failed')
      }
    }
    if (p.errored) return diffs
    const current = new Set(p.entries.map((e) => e.target))
    for (const t of written(host)) {
      if (current.has(t)) continue
      const st = host.disk.lstat(host.paths.host(t))
      if (st && st.kind !== 'dir') {
        diffs.push({ type: 'file', id: t, field: 'exists', expected: false, actual: true })
      }
    }
    return diffs
  }

  export async function all(host: Host): Promise<void> {
    if (!Disk.exists(host.disk, host.paths.etc.files)) return

    const { plan: p, vars } = loadPlan(host)

    for (const entry of p.entries) {
      try {
        if (entry.kind === 'file') await applyFile(host, entry, vars)
        else await applySymlink(host, entry)
      } catch (e) {
        host.log.error({ err: e, target: entry.target }, 'files: failed')
      }
    }

    reconcileManifest(host, p)
  }

  export const claims = (host: Host): Claims => ({
    exact: written(host).map((t) => path.join('/', t)),
    prefixes: [],
  })
}
