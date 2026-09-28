import { describe, expect, test } from 'bun:test'
import path from 'path'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import type { Diff } from '@bicycle/shared'
import { Age } from '@bicycle/core/age'
import type { Clock } from '@bicycle/core/clock'
import { Fail, type Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Log } from '@bicycle/core/log'
import { Paths } from '@bicycle/core/paths'
import { Ports } from '@bicycle/core/ports'

export namespace Testing {
  export const each = <T extends { name: string }>(
    suite: string,
    cases: T[],
    run: (it: T) => void | Promise<void>,
  ): void => {
    describe(suite, () => {
      for (const it of cases) test(it.name, () => run(it))
    })
  }

  export const epoch = Date.parse('2000-01-01T00:00:00.000Z')

  export type Outcome<T> = { value: T } | { error: string }

  export async function outcome<T>(run: () => T | Promise<T>): Promise<Outcome<T>> {
    try {
      return { value: await run() }
    } catch (e) {
      const kind = (e as { kind?: unknown }).kind
      if (typeof kind !== 'string') throw e
      return { error: kind }
    }
  }

  export type Time = { clock: Clock; wait: (ms: number) => void; next: () => boolean }

  type Timer = { due: number; seq: number; run: () => void }

  export function time(): Time {
    const state = { at: epoch, seq: 0 }
    const timers: Timer[] = []
    const earliest = (): Timer | undefined => timers.toSorted((a, b) => a.due - b.due || a.seq - b.seq)[0]
    const fire = (timer: Timer): void => {
      timers.splice(timers.indexOf(timer), 1)
      state.at = Math.max(state.at, timer.due)
      timer.run()
    }
    return {
      clock: {
        now: () => new Date(state.at),
        after: (ms, run) => {
          const timer = { due: state.at + ms, seq: state.seq++, run }
          timers.push(timer)
          return () => {
            const at = timers.indexOf(timer)
            if (at !== -1) timers.splice(at, 1)
          }
        },
      },
      wait: (ms) => {
        const until = state.at + ms
        for (let timer = earliest(); timer !== undefined && timer.due <= until; timer = earliest()) fire(timer)
        state.at = until
      },
      next: () => {
        const timer = earliest()
        if (timer === undefined) return false
        fire(timer)
        return true
      },
    }
  }

  const idle = (): Promise<void> => new Promise((done) => setImmediate(done))

  export async function drive<T>(time: Time, run: Promise<T>): Promise<T> {
    const state = { settled: false }
    const watched = run.finally(() => {
      state.settled = true
    })
    watched.catch(() => {})
    while (!state.settled) {
      await idle()
      if (!state.settled) time.next()
    }
    return watched
  }

  export type Actor = { uid: number; gid: number }

  export const ROOT: Actor = { uid: 0, gid: 0 }
  export const USER: Actor = { uid: 1000, gid: 1000 }

  type Meta = { mode: number; uid: number; gid: number; stamp: number }

  export type Node =
    | (Meta & { kind: 'file'; bytes: Uint8Array })
    | (Meta & { kind: 'dir' })
    | (Meta & { kind: 'symlink'; to: string })

  export type Volume = { disk: Disk; nodes: Map<string, Node>; actor: Actor; stamp: () => number }

  const UMASK = 0o022
  const HOPS = 8

  const bytes = (data: string | Uint8Array): Uint8Array =>
    typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)

  export function volume(actor: Actor): Volume {
    const nodes = new Map<string, Node>()
    const state = { stamp: 0 }
    const stamp = (): number => ++state.stamp
    nodes.set('/', { kind: 'dir', mode: 0o755, ...actor, stamp: stamp() })

    function locate(file: string, follow: boolean, hops = 0): string | null {
      if (hops > HOPS) throw new Fail.Error('io', { file, reason: 'too many levels of symbolic links' })
      const parts = path.resolve('/', file).split('/').filter(Boolean)
      const state = { at: '/' }
      for (const [i, part] of parts.entries()) {
        const next = path.join(state.at, part)
        const node = nodes.get(next)
        if (node === undefined) return null
        const last = i === parts.length - 1
        if (node.kind === 'symlink' && (!last || follow)) {
          return locate(path.join(path.resolve(state.at, node.to), ...parts.slice(i + 1)), follow, hops + 1)
        }
        if (!last && node.kind !== 'dir') return null
        state.at = next
      }
      return state.at
    }

    const may = (node: Node): boolean => {
      if (actor.uid === 0) return true
      if (node.uid === actor.uid) return (node.mode & 0o200) !== 0
      if (node.gid === actor.gid) return (node.mode & 0o020) !== 0
      return (node.mode & 0o002) !== 0
    }

    function parent(file: string): { dir: string; at: string } {
      const dir = locate(path.dirname(path.resolve('/', file)), true)
      if (dir === null || nodes.get(dir)!.kind !== 'dir') throw new Fail.Error('missing', { file })
      return { dir, at: path.join(dir, path.basename(file)) }
    }

    function writable(file: string): { dir: string; at: string } {
      const found = parent(file)
      if (!may(nodes.get(found.dir)!)) throw new Fail.Error('denied', { file })
      return found
    }

    function existing(file: string, follow: boolean): { at: string; node: Node } {
      const at = locate(file, follow)
      if (at === null) throw new Fail.Error('missing', { file })
      return { at, node: nodes.get(at)! }
    }

    const stat = (file: string, follow: boolean): Disk.Stat | null => {
      const at = locate(file, follow)
      if (at === null) return null
      const node = nodes.get(at)!
      return { kind: node.kind, mode: node.mode, uid: node.uid, gid: node.gid }
    }

    function chown(file: string, follow: boolean, uid: number, gid: number): boolean {
      const { node } = existing(file, follow)
      const want = { uid: uid === -1 ? node.uid : uid, gid: gid === -1 ? node.gid : gid }
      const mine = node.uid === actor.uid && want.uid === node.uid && (want.gid === node.gid || want.gid === actor.gid)
      if (actor.uid !== 0 && !mine) return false
      node.uid = want.uid
      node.gid = want.gid
      node.stamp = stamp()
      return true
    }

    function mkdir(dir: string): void {
      const full = path.resolve('/', dir)
      const at = locate(full, true)
      if (at !== null) {
        if (nodes.get(at)!.kind !== 'dir') throw new Fail.Error('io', { file: dir, reason: 'file exists' })
        return
      }
      mkdir(path.dirname(full))
      const made = writable(full)
      nodes.set(made.at, { kind: 'dir', mode: 0o777 & ~UMASK, ...actor, stamp: stamp() })
    }

    function write(file: string, data: string | Uint8Array, mode?: number): void {
      const at = locate(file, true)
      if (at !== null) {
        const node = nodes.get(at)!
        if (node.kind !== 'file') throw new Fail.Error('io', { file, reason: 'is a directory' })
        if (!may(node)) throw new Fail.Error('denied', { file })
        node.bytes = bytes(data)
        node.stamp = stamp()
        return
      }
      const made = writable(file)
      nodes.set(made.at, {
        kind: 'file',
        bytes: bytes(data),
        mode: (mode ?? 0o666) & ~UMASK,
        ...actor,
        stamp: stamp(),
      })
    }

    function rename(from: string, to: string): void {
      const source = existing(from, false)
      writable(source.at)
      const dest = writable(to)
      const over = nodes.get(dest.at)
      if (over !== undefined && over.kind === 'dir') throw new Fail.Error('io', { file: to, reason: 'is a directory' })
      const moved = [...nodes.keys()].filter((key) => key === source.at || key.startsWith(`${source.at}/`))
      for (const key of moved) {
        const node = nodes.get(key)!
        nodes.delete(key)
        nodes.set(dest.at + key.slice(source.at.length), node)
      }
    }

    const disk: Disk = {
      stat: (file) => stat(file, true),
      lstat: (file) => stat(file, false),
      read: (file) => {
        const { node } = existing(file, true)
        if (node.kind !== 'file') throw new Fail.Error('io', { file, reason: 'is a directory' })
        return new Uint8Array(node.bytes)
      },
      list: (dir) => {
        const { at, node } = existing(dir, true)
        if (node.kind !== 'dir') throw new Fail.Error('io', { file: dir, reason: 'not a directory' })
        return [...nodes.entries()]
          .filter(([key]) => key !== '/' && path.dirname(key) === at)
          .map(([key, child]) => ({ name: path.basename(key), kind: child.kind }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      },
      readlink: (file) => {
        const { node } = existing(file, false)
        if (node.kind !== 'symlink') throw new Fail.Error('io', { file, reason: 'not a symbolic link' })
        return node.to
      },
      write,
      mkdir,
      symlink: (to, file) => {
        const made = writable(file)
        if (nodes.has(made.at)) throw new Fail.Error('io', { file, reason: 'file exists' })
        nodes.set(made.at, { kind: 'symlink', to, mode: 0o777, ...actor, stamp: stamp() })
      },
      rename,
      copy: (from, to) => {
        const { node } = existing(from, true)
        if (node.kind !== 'file') throw new Fail.Error('io', { file: from, reason: 'is a directory' })
        write(to, node.bytes, node.mode)
      },
      remove: (file) => {
        const at = locate(file, false)
        if (at === null) return
        if (nodes.get(at)!.kind === 'dir') throw new Fail.Error('io', { file, reason: 'is a directory' })
        writable(at)
        nodes.delete(at)
      },
      chmod: (file, mode) => {
        const { node } = existing(file, true)
        if (actor.uid !== 0 && node.uid !== actor.uid) throw new Fail.Error('denied', { file })
        node.mode = mode
        node.stamp = stamp()
      },
      chown: (file, uid, gid) => chown(file, true, uid, gid),
      lchown: (file, uid, gid) => chown(file, false, uid, gid),
    }

    return { disk, nodes, actor, stamp }
  }

  export type UnitFile = { unit_file: string; state: string; preset: string | null }

  export type Units = {
    enabled?: string[]
    active?: string[]
    unitFiles?: UnitFile[]
  }

  export type System = Units & {
    installed?: string[]
    explicit?: string[]
    foreign?: string[]
    userManagers?: Record<string, Units>
    users?: { name: string; uid: number; groups?: string[] }[]
    groups?: { name: string; gid: number }[]
    ingress?: { status: string }
  }

  export type User = { name: string; uid: number; gid: number; groups: string[]; password: string | null }
  export type Group = { name: string; gid: number }
  export type Manager = Required<Units>
  export type Project = { files: string[]; dir: string | null; env: Record<string, string> }
  export type Tree = Record<string, string>
  export type Checkout = { remote: string | null; sparse: string[]; fetched: Tree | null }

  export type Reply = { code?: number; stdout?: string; stderr?: string; changed?: boolean }
  export type Fault = { program: string; args: string[]; reply: Reply }

  export type Script = {
    out?: string
    err?: string
    code?: number
    takes?: number
    hangs?: boolean
    open?: boolean
    stubborn?: boolean
  }
  export type Seen = { env: Record<string, string>; read: (file: string) => string }
  export type Detector = (seen: Seen) => Script

  export type Machine = {
    users: User[]
    groups: Group[]
    installed: string[]
    explicit: string[]
    foreign: string[]
    managers: Record<string, Manager>
    containers: Record<string, string>
    networks: string[]
    projects: Record<string, Project>
    repos: Record<string, Record<string, Tree>>
    checkouts: Record<string, Checkout>
    detectors: Record<string, Detector>
    faults: Fault[]
    calls: string[]
    changes: string[]
  }

  const SYSTEM = ''
  const INGRESS = 'bicycle-ingress'

  const machine = (): Machine => ({
    users: [{ name: 'root', uid: 0, gid: 0, groups: [], password: null }],
    groups: [
      { name: 'root', gid: 0 },
      { name: 'wheel', gid: 998 },
    ],
    installed: [],
    explicit: [],
    foreign: [],
    managers: {},
    containers: {},
    networks: [],
    projects: {},
    repos: {},
    checkouts: {},
    detectors: {},
    faults: [],
    calls: [],
    changes: [],
  })

  const manager = (m: Machine, name: string): Manager =>
    (m.managers[name] ??= { enabled: [], active: [], unitFiles: [] })

  function units(m: Machine, name: string, seed: Units): void {
    const found = manager(m, name)
    if (seed.enabled) found.enabled = [...seed.enabled]
    if (seed.active) found.active = [...seed.active]
    if (seed.unitFiles) found.unitFiles = [...seed.unitFiles]
  }

  export function seed(w: World, system: System): void {
    const m = w.machine
    if (system.installed) m.installed = [...system.installed]
    if (system.explicit) m.explicit = [...system.explicit]
    if (system.foreign) m.foreign = [...system.foreign]
    units(m, SYSTEM, system)
    for (const [user, mine] of Object.entries(system.userManagers ?? {})) units(m, user, mine)
    for (const u of system.users ?? []) {
      m.users.push({ name: u.name, uid: u.uid, gid: u.uid, groups: u.groups ?? [], password: null })
    }
    for (const g of system.groups ?? []) m.groups.push({ name: g.name, gid: g.gid })
    if (system.ingress) m.containers[INGRESS] = system.ingress.status
  }

  type Program = (w: World, args: string[], run: Host.Run) => Reply

  const flag = (args: string[], name: string): string | undefined => {
    const at = args.indexOf(name)
    return at === -1 ? undefined : args[at + 1]
  }

  const flags = (args: string[], name: string): string[] =>
    args.flatMap((arg, at) => (arg === name && args[at + 1] !== undefined ? [args[at + 1]!] : []))

  const listed = (text: string | undefined): string[] => (text === undefined ? [] : text.split(',').filter(Boolean))

  const lines = (rows: string[]): string => rows.map((row) => `${row}\n`).join('')

  const passwd = (u: User): string => `${u.name}:x:${u.uid}:${u.gid}::/home/${u.name}:/bin/bash`

  const group = (m: Machine, g: Group): string =>
    `${g.name}:x:${g.gid}:${m.users
      .filter((u) => u.groups.includes(g.name))
      .map((u) => u.name)
      .join(',')}`

  const free = (taken: number[]): number => {
    const used = new Set(taken)
    for (let id = 1000; ; id++) if (!used.has(id)) return id
  }

  const strangers = (m: Machine, names: string[]): string[] =>
    names.filter((name) => !m.groups.some((g) => g.name === name))

  const RULE = /^[A-Za-z_][\w.-]* ALL=\(ALL:ALL\) (NOPASSWD: )?ALL$/

  function scope(args: string[]): { name: string; rest: string[] } {
    if (args[0] === '--user' && args[1] === '-M') return { name: (args[2] ?? '').replace(/@$/, ''), rest: args.slice(3) }
    return { name: SYSTEM, rest: args }
  }

  function compose(w: World, args: string[], run: Host.Run): Reply {
    const name = flag(args, '-p')
    if (name === undefined) return { code: 1, stderr: 'no project name' }
    if (args.includes('down')) {
      delete w.machine.projects[name]
      return { changed: true }
    }
    if (!args.includes('up')) return { code: 1, stderr: `unknown docker command: ${args.join(' ')}` }
    const files = flags(args, '-f')
    const lost = files.filter((file) => w.volume.disk.stat(file) === null)
    if (lost.length > 0) return { code: 1, stderr: `open ${lost[0]}: no such file or directory` }
    w.machine.projects[name] = { files, dir: flag(args, '--project-directory') ?? null, env: run.env ?? {} }
    if (name === INGRESS) w.machine.containers[INGRESS] = 'running'
    return { changed: true }
  }

  function network(w: World, args: string[]): Reply {
    const [verb, name] = args
    if (name === undefined) return { code: 1 }
    const found = w.machine.networks.includes(name)
    if (verb === 'inspect') return found ? {} : { code: 1, stderr: `Error response from daemon: network ${name} not found` }
    if (verb !== 'create' || found) return { code: 1 }
    w.machine.networks.push(name)
    return { changed: true }
  }

  function checkout(w: World, dest: string, found: Checkout): Reply {
    if (found.fetched === null) return { code: 128, stderr: "fatal: couldn't resolve FETCH_HEAD" }
    for (const [rel, contents] of Object.entries(found.fetched)) {
      const top = rel.split('/')[0]!
      if (rel.includes('/') && !found.sparse.includes(top)) continue
      const file = path.join(dest, rel)
      w.volume.disk.mkdir(path.dirname(file))
      w.volume.disk.write(file, contents)
    }
    return {}
  }

  function git(w: World, args: string[]): Reply {
    const dest = flag(args, '-C')
    if (dest === undefined) return { code: 129, stderr: 'usage: git -C <path>' }
    const [verb, ...rest] = args.slice(args.indexOf('-C') + 2)
    if (verb === 'init') {
      w.volume.disk.mkdir(path.join(dest, '.git'))
      w.machine.checkouts[dest] = { remote: null, sparse: [], fetched: null }
      return {}
    }
    const found = w.machine.checkouts[dest]
    if (found === undefined) return { code: 128, stderr: 'fatal: not a git repository' }
    switch (verb) {
      case 'remote':
        found.remote = rest[2] ?? null
        return {}
      case 'config':
        return {}
      case 'sparse-checkout':
        if (rest[0] === 'set') found.sparse = rest.slice(1)
        return {}
      case 'fetch': {
        const ref = rest.at(-1)!
        const tree = found.remote === null ? undefined : w.machine.repos[found.remote]?.[ref]
        if (tree === undefined) return { code: 128, stderr: `fatal: couldn't find remote ref ${ref}` }
        found.fetched = tree
        return {}
      }
      case 'checkout':
        return checkout(w, dest, found)
      default:
        return { code: 1, stderr: `git: '${verb}' is not a git command` }
    }
  }

  const PROGRAMS: Record<string, Program> = {
    getent: (w, [db, name]) => {
      const m = w.machine
      if (db !== 'passwd' && db !== 'group') return { code: 1 }
      const rows =
        db === 'passwd'
          ? m.users.map((u) => ({ name: u.name, line: passwd(u) }))
          : m.groups.map((g) => ({ name: g.name, line: group(m, g) }))
      if (name === undefined) return { stdout: lines(rows.map((row) => row.line)) }
      const row = rows.find((row) => row.name === name)
      return row === undefined ? { code: 2 } : { stdout: lines([row.line]) }
    },
    id: (w, args) => {
      const m = w.machine
      const user = m.users.find((u) => u.name === args.at(-1))
      if (user === undefined) return { code: 1, stderr: `id: '${args.at(-1)}': no such user` }
      const primary = m.groups.find((g) => g.gid === user.gid)?.name ?? String(user.gid)
      return { stdout: lines([[primary, ...user.groups].join(' ')]) }
    },
    useradd: (w, args) => {
      const m = w.machine
      const name = args.at(-1)!
      if (m.users.some((u) => u.name === name)) return { code: 9, stderr: `useradd: user '${name}' already exists` }
      const asked = flag(args, '-u')
      const uid = asked === undefined ? free(m.users.map((u) => u.uid)) : Number(asked)
      if (m.users.some((u) => u.uid === uid)) return { code: 4, stderr: `useradd: UID ${uid} is not unique` }
      const groups = listed(flag(args, '-G'))
      const strange = strangers(m, groups)
      if (strange.length > 0) return { code: 6, stderr: `useradd: group '${strange[0]}' does not exist` }
      const mine = m.groups.find((g) => g.name === name) ?? { name, gid: free(m.groups.map((g) => g.gid)) }
      if (!m.groups.includes(mine)) m.groups.push(mine)
      m.users.push({ name, uid, gid: mine.gid, groups, password: null })
      if (args.includes('-m')) dir(w, `/home/${name}`, 0o700, { uid, gid: mine.gid })
      return { changed: true }
    },
    chpasswd: (w, _, run) => {
      const pairs = (run.stdin ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ name: line.slice(0, line.indexOf(':')), password: line.slice(line.indexOf(':') + 1) }))
      if (pairs.length === 0) return { code: 1, stderr: 'chpasswd: nothing on stdin' }
      for (const pair of pairs) {
        const user = w.machine.users.find((u) => u.name === pair.name)
        if (user === undefined) return { code: 1, stderr: `chpasswd: user '${pair.name}' does not exist` }
        user.password = pair.password
      }
      return { changed: true }
    },
    usermod: (w, args) => {
      const user = w.machine.users.find((u) => u.name === args.at(-1))
      if (user === undefined) return { code: 6, stderr: `usermod: user '${args.at(-1)}' does not exist` }
      const groups = listed(flag(args, '-aG'))
      const strange = strangers(w.machine, groups)
      if (strange.length > 0) return { code: 6, stderr: `usermod: group '${strange[0]}' does not exist` }
      user.groups = [...new Set([...user.groups, ...groups])]
      return { changed: true }
    },
    groupadd: (w, args) => {
      const m = w.machine
      const name = args.at(-1)!
      const gid = Number(flag(args, '-g'))
      if (m.groups.some((g) => g.name === name)) return { code: 9, stderr: `groupadd: group '${name}' already exists` }
      if (m.groups.some((g) => g.gid === gid)) return { code: 4, stderr: `groupadd: GID '${gid}' already exists` }
      m.groups.push({ name, gid })
      return { changed: true }
    },
    pacman: (w, args) => {
      const m = w.machine
      const versioned = (names: string[]) => lines(names.map((name) => `${name} 1.0-1`))
      switch (args[0]) {
        case '-Qq':
          return { stdout: lines(m.installed) }
        case '-Qen':
          return { stdout: versioned(m.explicit) }
        case '-Qem':
          return { stdout: versioned(m.foreign) }
        case '-S': {
          const names = args.slice(1).filter((arg) => !arg.startsWith('-'))
          m.installed = [...new Set([...m.installed, ...names])]
          m.explicit = [...new Set([...m.explicit, ...names])]
          return { changed: true }
        }
        default:
          return { code: 1, stderr: `pacman: unknown operation ${args[0]}` }
      }
    },
    systemctl: (w, args) => {
      const { name, rest } = scope(args)
      const mine = manager(w.machine, name)
      const unit = rest.at(-1)!
      switch (rest[0]) {
        case 'is-enabled':
          return { code: mine.enabled.includes(unit) ? 0 : 1 }
        case 'is-active':
          return { code: mine.active.includes(unit) ? 0 : 1 }
        case 'list-unit-files':
          return { stdout: lines([JSON.stringify(mine.unitFiles)]) }
        case 'daemon-reload':
          return { changed: true }
        case 'enable':
          mine.enabled = [...new Set([...mine.enabled, unit])]
          if (rest.includes('--now')) mine.active = [...new Set([...mine.active, unit])]
          return { changed: true }
        default:
          return { code: 1, stderr: `Unknown command verb '${rest[0]}'` }
      }
    },
    docker: (w, args, run) => {
      const [verb, ...rest] = args
      switch (verb) {
        case 'inspect': {
          const name = rest.at(-1)!
          const status = w.machine.containers[name]
          if (status === undefined) return { code: 1, stderr: `Error: No such object: ${name}` }
          return { stdout: lines([status]) }
        }
        case 'compose':
          return compose(w, rest, run)
        case 'exec':
          if (w.machine.containers[rest[0]!] !== 'running') {
            return { code: 1, stderr: `Error response from daemon: container ${rest[0]} is not running` }
          }
          return { changed: true }
        case 'network':
          return network(w, rest)
        default:
          return { code: 1, stderr: `unknown docker command: ${verb}` }
      }
    },
    git: (w, args) => git(w, args),
    visudo: (w, args) => {
      const file = args.at(-1)!
      const rules = text(w, file)
        ?.split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      if (rules === undefined) return { code: 1, stderr: `visudo: unable to open ${file}` }
      const bad = rules.find((rule) => !RULE.test(rule))
      if (bad !== undefined) return { code: 1, stderr: `${file}: syntax error near "${bad}"` }
      return { stdout: lines([`${file}: parsed OK`]) }
    },
  }

  const spoken = (cmd: string[], stdin?: string): string =>
    stdin === undefined ? cmd.join(' ') : `${cmd.join(' ')} < ${stdin.trimEnd()}`

  const forced = (m: Machine, cmd: string[]): Fault | undefined =>
    m.faults.find((fault) => fault.program === cmd[0] && fault.args.every((arg) => cmd.slice(1).includes(arg)))

  function exec(w: World, cmd: string[], run: Host.Run): Host.Result {
    const said = spoken(cmd, run.stdin)
    w.machine.calls.push(said)
    const program = PROGRAMS[cmd[0]!]
    if (program === undefined) return { code: 127, stdout: '', stderr: `${cmd[0]}: command not found` }
    const reply = forced(w.machine, cmd)?.reply ?? program(w, cmd.slice(1), run)
    if (reply.changed) w.machine.changes.push(said)
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }
  }

  const SIGNALS: Record<Host.Signal, number> = { SIGTERM: 143, SIGKILL: 137 }

  function spawn(w: World, cmd: string[], env: Record<string, string>): Host.Proc {
    const program = w.machine.detectors[cmd[0]!]
    if (program === undefined) throw new Error(`${cmd[0]}: command not found`)
    w.machine.calls.push(spoken(cmd))
    const script = program({ env, read: (file) => text(w, file) ?? '' })
    const exit = Promise.withResolvers<number>()
    const state = { exited: false }
    const pipes: ReadableStreamDefaultController<Uint8Array>[] = []

    const pipe = (said: string, open: boolean): ReadableStream<Uint8Array> =>
      new ReadableStream({
        start(c) {
          if (said !== '') c.enqueue(new TextEncoder().encode(said))
          if (open) pipes.push(c)
          else c.close()
        },
      })

    const leave = (code: number): void => {
      if (state.exited) return
      state.exited = true
      if (!script.open) for (const c of pipes.splice(0)) c.close()
      exit.resolve(code)
    }

    const waits = script.hangs === true || script.takes !== undefined
    const proc: Host.Proc = {
      stdout: pipe(script.out ?? '', waits || script.open === true),
      stderr: pipe(script.err ?? '', waits),
      exited: exit.promise,
      kill: (signal) => {
        if (signal === 'SIGTERM' && script.stubborn) return
        leave(SIGNALS[signal])
      },
    }
    if (script.takes !== undefined) w.time.clock.after(script.takes, () => leave(script.code ?? 0))
    else if (!script.hangs) leave(script.code ?? 0)
    return proc
  }

  export type World = {
    host: Host
    volume: Volume
    machine: Machine
    time: Time
    lines: Log.Line[]
    recipient: string
  }

  export type Setup = { as?: Actor }

  export const ROOTS: Paths.Roots = {
    etc: '/etc/bicycle',
    state: '/var/lib/bicycle',
    run: '/run/bicycle',
    root: '/',
    key: '/etc/bicycle/age.key',
    scanner: 'bicycle-fs-scan',
  }

  export async function world(setup: Setup = {}): Promise<World> {
    const identity = await generateIdentity()
    const logged: Log.Line[] = []
    const paths = Paths.of(ROOTS)
    const clock = time()
    const disk = volume(setup.as ?? ROOT)
    const w: World = {
      volume: disk,
      machine: machine(),
      time: clock,
      lines: logged,
      recipient: await identityToRecipient(identity),
      host: {
        paths,
        log: Log.to((line) => logged.push(line)),
        clock: clock.clock,
        disk: disk.disk,
        exec: async (cmd, run = {}) => exec(w, cmd, run),
        spawn: (cmd, env) => spawn(w, cmd, env),
      },
    }
    dir(w, paths.etc.root)
    put(w, paths.key, `${identity}\n`, 0o600)
    return w
  }

  export async function within(run: (w: World) => void | Promise<void>, setup: Setup = {}): Promise<void> {
    await run(await world(setup))
  }

  export const levels = (w: World, level: Log.Level): string[] =>
    w.lines.filter((line) => line.level === level).map((line) => line.msg)

  export function dir(w: World, target: string, mode?: number, owner?: Actor): void {
    const full = path.resolve('/', target)
    const { nodes, actor, stamp } = w.volume
    if (full !== '/') dir(w, path.dirname(full))
    const found = nodes.get(full)
    if (found === undefined) nodes.set(full, { kind: 'dir', mode: mode ?? 0o755, ...(owner ?? actor), stamp: stamp() })
    else if (mode !== undefined) found.mode = mode
  }

  export function put(w: World, file: string, data: string | Uint8Array, mode?: number): void {
    const full = path.resolve('/', file)
    const { nodes, actor, stamp } = w.volume
    dir(w, path.dirname(full))
    const found = nodes.get(full)
    nodes.set(full, {
      kind: 'file',
      bytes: bytes(data),
      mode: mode ?? found?.mode ?? 0o644,
      uid: found?.uid ?? actor.uid,
      gid: found?.gid ?? actor.gid,
      stamp: stamp(),
    })
  }

  export const node = (w: World, file: string): Node | undefined => w.volume.nodes.get(path.resolve('/', file))

  export function text(w: World, file: string): string | undefined {
    const found = node(w, file)
    return found?.kind === 'file' ? Buffer.from(found.bytes).toString('utf8') : undefined
  }

  function held(w: World, file: string): Node {
    const found = node(w, file)
    if (found === undefined) throw new Error(`${file} is not there`)
    return found
  }

  export function config(w: World, config: unknown): void {
    put(w, w.host.paths.etc.bicycle, typeof config === 'string' ? config : Bun.YAML.stringify(config))
  }

  export async function secret(w: World, addr: string, clear: string): Promise<void> {
    const sealed = await Age.encrypt(new TextEncoder().encode(clear), [w.recipient])
    put(w, path.join(w.host.paths.etc.secrets, `${addr}.age`), sealed)
  }

  export type Action =
    | { do: 'config'; config: unknown }
    | { do: 'file'; rel: string; contents: string; mode?: number }
    | { do: 'age'; rel: string; plaintext: string }
    | { do: 'secret'; addr: string; clear: string }
    | { do: 'host'; rel: string; contents: string }
    | { do: 'hostDir'; rel: string; mode?: number }
    | { do: 'chmodHost'; rel: string; mode: number }
    | { do: 'own'; file: string; uid: number; gid: number }
    | { do: 'backdate'; rel: string }
    | { do: 'rm'; rel: string }
    | { do: 'system'; system: System }
    | { do: 'fault'; program: string; args: string[]; reply: Reply }
    | { do: 'repo'; url: string; ref: string; tree: Tree }
    | { do: 'app'; name: string; config: unknown; override?: string }
    | { do: 'ports'; store: Ports.Store }
    | { do: 'state'; rel: string; contents: string }
    | { do: 'sweep' }

  export type Sweep = (host: Host) => Promise<void>

  export async function runActions(w: World, actions: readonly Action[], sweep: Sweep): Promise<void> {
    const { paths } = w.host
    for (const a of actions) {
      switch (a.do) {
        case 'config':
          config(w, a.config)
          break
        case 'file':
          put(w, path.join(paths.etc.files, a.rel), a.contents, a.mode ?? 0o644)
          break
        case 'age':
          put(
            w,
            path.join(paths.etc.files, a.rel),
            await Age.encrypt(new TextEncoder().encode(a.plaintext), [w.recipient]),
            0o644,
          )
          break
        case 'secret':
          await secret(w, a.addr, a.clear)
          break
        case 'host':
          put(w, paths.host(a.rel), a.contents)
          break
        case 'hostDir':
          dir(w, paths.host(a.rel), a.mode)
          break
        case 'chmodHost':
          held(w, paths.host(a.rel)).mode = a.mode
          break
        case 'own':
          Object.assign(held(w, a.file), { uid: a.uid, gid: a.gid })
          break
        case 'backdate':
          held(w, paths.host(a.rel)).stamp = 0
          break
        case 'rm':
          w.volume.nodes.delete(path.join(paths.etc.files, a.rel))
          break
        case 'system':
          seed(w, a.system)
          break
        case 'fault':
          w.machine.faults.push({ program: a.program, args: a.args, reply: a.reply })
          break
        case 'repo':
          ;(w.machine.repos[a.url] ??= {})[a.ref] = a.tree
          break
        case 'app':
          put(
            w,
            paths.etc.app(a.name).config,
            typeof a.config === 'string' ? a.config : Bun.YAML.stringify(a.config),
          )
          if (a.override !== undefined) put(w, paths.etc.app(a.name).compose, a.override)
          break
        case 'ports':
          Ports.write(w.host, a.store)
          break
        case 'state':
          put(w, path.join(paths.state.root, a.rel), a.contents)
          break
        case 'sweep':
          await sweep(w.host)
          break
      }
    }
  }

  export type FsCheck = {
    path: string
    contents?: string
    mode?: number
    owner?: Actor
    linkTo?: string
    dir?: boolean
    absent?: boolean
    stale?: boolean
  }

  export function checkFs(w: World, base: string, checks: readonly FsCheck[]): void {
    for (const c of checks) {
      const found = node(w, path.join(base, c.path))
      if (c.absent) {
        expect(found).toBeUndefined()
        continue
      }
      expect(found).toBeDefined()
      if (c.dir) expect(found!.kind).toBe('dir')
      if (c.linkTo !== undefined) expect(found).toMatchObject({ kind: 'symlink', to: c.linkTo })
      if (c.contents !== undefined) expect(text(w, path.join(base, c.path))).toBe(c.contents)
      if (c.mode !== undefined) expect(found!.mode).toBe(c.mode)
      if (c.owner !== undefined) expect({ uid: found!.uid, gid: found!.gid }).toEqual(c.owner)
      if (c.stale) expect(found!.stamp).toBe(0)
    }
  }

  export function expectDiffs(actual: readonly Diff[], want: readonly Partial<Diff>[]): void {
    expect(actual).toHaveLength(want.length)
    for (const [i, diff] of want.entries()) {
      expect(actual[i]).toMatchObject(diff)
      expect(actual[i]!.redacted).toBe(diff.redacted as boolean | undefined)
    }
  }

  export type Reconciler = {
    all: Sweep
    plan: (host: Host) => Promise<Diff[]>
  }

  export type PlanCase = {
    name: string
    config?: unknown
    system?: System
    sweep?: boolean
    plan: readonly Partial<Diff>[]
  }

  export const plans = (suite: string, mod: Reconciler, cases: PlanCase[]): void =>
    each(suite, cases, (it) =>
      within(async (w) => {
        if (it.system !== undefined) seed(w, it.system)
        if (it.config !== undefined) config(w, it.config)
        if (it.sweep) await mod.all(w.host)
        expectDiffs(await mod.plan(w.host), it.plan)
      }),
    )

  export type ReconcilerCase = {
    name: string
    as?: Actor
    actions: readonly Action[]
    rejects?: RegExp | true
    fs?: readonly FsCheck[]
    state?: readonly FsCheck[]
    ports?: Ports.Store
    calls?: string[]
    changes?: string[]
    errors?: string[]
    warns?: string[]
    plan?: readonly Partial<Diff>[]
  }

  export async function runReconcilerCase(
    w: World,
    mod: Pick<Reconciler, 'plan'>,
    sweep: Sweep,
    c: ReconcilerCase,
  ): Promise<void> {
    const run = runActions(w, c.actions, sweep)
    if (c.rejects === undefined) await run
    else if (c.rejects === true) await expect(run).rejects.toThrow()
    else await expect(run).rejects.toThrow(c.rejects)
    if (c.fs) checkFs(w, w.host.paths.host(''), c.fs)
    if (c.state) checkFs(w, w.host.paths.state.root, c.state)
    if (c.ports) expect(Ports.read(w.host)).toEqual(c.ports)
    if (c.calls) expect(w.machine.calls).toEqual(c.calls)
    if (c.changes) expect(w.machine.changes).toEqual(c.changes)
    if (c.errors) expect(levels(w, 'error')).toEqual(c.errors)
    if (c.warns) expect(levels(w, 'warn')).toEqual(c.warns)
    if (c.plan) expectDiffs(await mod.plan(w.host), c.plan)
  }

  export const reconciles = (suite: string, mod: Reconciler, cases: ReconcilerCase[]): void =>
    each(suite, cases, (it) => within((w) => runReconcilerCase(w, mod, mod.all, it), { as: it.as }))
}
