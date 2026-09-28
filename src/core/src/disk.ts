import fs from 'fs'
import path from 'path'

export namespace Fail {
  export type Data = {
    missing: { file: string }
    denied: { file: string }
    io: { file: string; reason: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    missing: (d) => `${d.file} is not there`,
    denied: (d) => `${d.file}: permission denied`,
    io: (d) => `${d.file}: ${d.reason}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'DiskError'
    }
  }
}

export interface Disk {
  stat: (file: string) => Disk.Stat | null
  lstat: (file: string) => Disk.Stat | null
  read: (file: string) => Uint8Array
  list: (dir: string) => Disk.Entry[]
  readlink: (file: string) => string
  write: (file: string, data: string | Uint8Array, mode?: number) => void
  mkdir: (dir: string) => void
  symlink: (to: string, file: string) => void
  rename: (from: string, to: string) => void
  copy: (from: string, to: string) => void
  remove: (file: string) => void
  chmod: (file: string, mode: number) => void
  chown: (file: string, uid: number, gid: number) => boolean
  lchown: (file: string, uid: number, gid: number) => boolean
}

export namespace Disk {
  export type Kind = 'file' | 'dir' | 'symlink' | 'special'
  export type Stat = { kind: Kind; mode: number; uid: number; gid: number }
  export type Entry = { name: string; kind: Kind }

  type Typed = { isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }

  const kind = (it: Typed): Kind => {
    if (it.isSymbolicLink()) return 'symlink'
    if (it.isDirectory()) return 'dir'
    if (it.isFile()) return 'file'
    return 'special'
  }

  const stat = (st: fs.Stats): Stat => ({ kind: kind(st), mode: st.mode & 0o7777, uid: st.uid, gid: st.gid })

  function failure(file: string, error: unknown): Fail.Error {
    const { code, message } = error as NodeJS.ErrnoException
    if (code === 'ENOENT' || code === 'ENOTDIR') return new Fail.Error('missing', { file })
    if (code === 'EPERM' || code === 'EACCES') return new Fail.Error('denied', { file })
    return new Fail.Error('io', { file, reason: message })
  }

  function run<T>(file: string, op: () => T): T {
    try {
      return op()
    } catch (error) {
      throw failure(file, error)
    }
  }

  function found<T>(file: string, op: () => T): T | null {
    try {
      return op()
    } catch (error) {
      const fail = failure(file, error)
      if (fail.kind === 'missing') return null
      throw fail
    }
  }

  function allowed(file: string, op: () => void): boolean {
    try {
      op()
      return true
    } catch (error) {
      const fail = failure(file, error)
      if (fail.kind === 'denied') return false
      throw fail
    }
  }

  export function real(PATH: string): Disk {
    const special = (file: string, mode: number): void => {
      const bin = Bun.which('chmod', { PATH })
      if (bin === null) throw new Fail.Error('io', { file, reason: 'chmod: command not found' })
      const done = Bun.spawnSync([bin, mode.toString(8), file])
      if (done.exitCode === 0) return
      throw new Fail.Error('io', { file, reason: `chmod ${mode.toString(8)}: ${done.stderr.toString().trim()}` })
    }

    return {
      stat: (file) => found(file, () => stat(fs.statSync(file))),
      lstat: (file) => found(file, () => stat(fs.lstatSync(file))),
      read: (file) => run(file, () => new Uint8Array(fs.readFileSync(file))),
      list: (dir) =>
        run(dir, () => fs.readdirSync(dir, { withFileTypes: true }).map((ent) => ({ name: ent.name, kind: kind(ent) }))),
      readlink: (file) => run(file, () => fs.readlinkSync(file)),
      write: (file, data, mode) => run(file, () => fs.writeFileSync(file, data, mode === undefined ? {} : { mode })),
      mkdir: (dir) => {
        run(dir, () => fs.mkdirSync(dir, { recursive: true }))
      },
      symlink: (to, file) => run(file, () => fs.symlinkSync(to, file)),
      rename: (from, to) => run(to, () => fs.renameSync(from, to)),
      copy: (from, to) => run(to, () => fs.copyFileSync(from, to)),
      remove: (file) => run(file, () => fs.rmSync(file, { force: true })),
      chmod: (file, mode) => {
        const kept = run(file, () => {
          fs.chmodSync(file, mode)
          return fs.statSync(file).mode & 0o7777
        })
        if (kept !== mode) special(file, mode)
      },
      chown: (file, uid, gid) => allowed(file, () => fs.chownSync(file, uid, gid)),
      lchown: (file, uid, gid) => allowed(file, () => fs.lchownSync(file, uid, gid)),
    }
  }

  export const octal = (mode: number): string => `0${mode.toString(8)}`

  export const exists = (disk: Disk, file: string): boolean => disk.stat(file) !== null

  export const text = (disk: Disk, file: string): string => Buffer.from(disk.read(file)).toString('utf8')

  export function known(file: string, st: Stat | null): Stat {
    if (st === null) throw new Fail.Error('missing', { file })
    return st
  }

  export function walk(disk: Disk, root: string): string[] {
    const out: string[] = []
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()!
      for (const ent of disk.list(dir)) {
        const full = path.join(dir, ent.name)
        if (ent.kind === 'dir') stack.push(full)
        else if (ent.kind === 'file') out.push(full)
      }
    }
    return out
  }

  export function replace(disk: Disk, dest: string, text: string): void {
    const tmp = `${dest}.tmp`
    disk.write(tmp, text)
    disk.rename(tmp, dest)
  }

  export function adopt(disk: Disk, target: string): void {
    const parent = known(path.dirname(target), disk.stat(path.dirname(target)))
    disk.chown(target, parent.uid, parent.gid)
  }

  export function nest(disk: Disk, dir: string): void {
    if (exists(disk, dir)) return
    nest(disk, path.dirname(dir))
    disk.mkdir(dir)
    adopt(disk, dir)
  }

  export function own(disk: Disk, target: string, uid: number, gid: number): void {
    const st = known(target, disk.lstat(target))
    if (st.uid !== uid || st.gid !== gid) disk.lchown(target, uid, gid)
    if (st.kind !== 'dir') return
    for (const ent of disk.list(target)) own(disk, path.join(target, ent.name), uid, gid)
  }
}
