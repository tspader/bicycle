import path from 'path'
import { Age } from '@bicycle/core/age'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import type { Paths } from '@bicycle/core/paths'

export namespace Fail {
  export type Data = {
    'bad-addr': { addr: string }
    'no-secret': { addr: string }
    'no-recipients': { file: string }
    empty: { addr: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    'bad-addr': (d) => `"${d.addr}" is not a secret address`,
    'no-secret': (d) => `no secret at ${d.addr}`,
    'no-recipients': (d) => `no recipients in ${d.file}`,
    empty: (d) => `refusing to write an empty secret to ${d.addr}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'SecretsError'
    }
  }
}

export namespace Secrets {
  const SUFFIX = '.age'

  export function file(paths: Paths, addr: string): string {
    const parts = addr.split('/')
    if (parts.some((part) => part === '' || part === '.' || part === '..' || part !== part.trim())) {
      throw new Fail.Error('bad-addr', { addr })
    }
    return path.join(paths.etc.secrets, `${addr}${SUFFIX}`)
  }

  export async function read(host: Host, addr: string): Promise<string> {
    const at = file(host.paths, addr)
    if (!Disk.exists(host.disk, at)) throw new Fail.Error('no-secret', { addr })
    return Age.text(host.disk, host.paths.key, at)
  }

  export async function write(host: Host, addr: string, clear: Uint8Array): Promise<string> {
    const { paths, disk } = host
    const at = file(paths, addr)
    if (clear.length === 0) throw new Fail.Error('empty', { addr })
    const to = Age.recipients(disk, paths.etc.recipients)
    if (to.length === 0) throw new Fail.Error('no-recipients', { file: paths.etc.recipients })
    const sealed = await Age.encrypt(clear, to)
    Disk.nest(disk, path.dirname(at))
    disk.write(at, sealed, 0o600)
    Disk.adopt(disk, at)
    return at
  }

  export function list(host: Host): string[] {
    const root = host.paths.etc.secrets
    if (!Disk.exists(host.disk, root)) return []
    return Disk.walk(host.disk, root)
      .filter((found) => found.endsWith(SUFFIX))
      .map((found) => path.relative(root, found).slice(0, -SUFFIX.length))
      .sort()
  }

  export function remove(host: Host, addr: string): void {
    const at = file(host.paths, addr)
    if (!Disk.exists(host.disk, at)) throw new Fail.Error('no-secret', { addr })
    host.disk.remove(at)
  }
}
