import type { Diff } from '@bicycle/shared'
import type { Host } from '@bicycle/core/host'
import { Tree } from '@bicycle/core/tree'

export namespace Packages {
  async function query(host: Host, flag: string): Promise<string[]> {
    const r = await host.exec(['pacman', flag])
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .map((l) => l.split(/\s+/)[0]!)
      .filter(Boolean)
  }

  const undeclared = (pkg: string): Diff => ({
    type: 'package',
    id: pkg,
    field: 'installed',
    expected: null,
    actual: true,
  })

  export async function plan(host: Host): Promise<Diff[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const sets = cfg.packages ?? {}
    const installed = new Set(await query(host, '-Qq'))
    const declared = new Set(Object.values(sets).flat())
    const missing = (sets.extra ?? [])
      .filter((pkg) => !installed.has(pkg))
      .map((pkg): Diff => ({ type: 'package', id: pkg, field: 'installed', expected: true, actual: false }))
    const native = (await query(host, '-Qen')).filter((pkg) => !declared.has(pkg)).map(undeclared)
    const foreign = (await query(host, '-Qem'))
      .filter((pkg) => !declared.has(pkg))
      .map((pkg): Diff => ({ ...undeclared(pkg), meta: { foreign: true } }))
    return [...missing, ...native, ...foreign]
  }

  export async function all(host: Host): Promise<void> {
    const missing = (await plan(host)).filter((d) => d.expected !== null).map((d) => d.id)
    if (missing.length === 0) return

    host.log.info({ packages: missing }, 'packages: installing')
    const r = await host.exec(['pacman', '-S', '--needed', '--noconfirm', ...missing])
    if (r.code !== 0) {
      host.log.error({ packages: missing, exitCode: r.code, stderr: r.stderr.trim() }, 'packages: failed to install')
      return
    }
    host.log.info({ packages: missing }, 'packages: installed')
  }
}
