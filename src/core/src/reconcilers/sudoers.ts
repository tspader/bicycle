import crypto from 'crypto'
import path from 'path'
import type { Diff, SudoMode } from '@bicycle/shared'
import type { Claims } from '@bicycle/core/detect/claims'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Tree } from '@bicycle/core/tree'

export namespace Sudoers {
  type SudoUser = { name: string; sudo: SudoMode }

  const rules: Record<SudoMode, (name: string) => string[]> = {
    none: () => [],
    password: (name) => [`${name} ALL=(ALL:ALL) ALL`],
    passwordless: (name) => [`${name} ALL=(ALL:ALL) NOPASSWD: ALL`],
  }

  export const rulesFor = (users: SudoUser[]): string[] => users.flatMap((u) => rules[u.sudo](u.name))

  const TARGET = 'etc/sudoers.d/bicycle'

  const render = (lines: string[]): string => `# Managed by Bicycle. Do not edit.\n${lines.join('\n')}\n`

  const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')

  export async function plan(host: Host): Promise<Diff[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const dest = host.paths.host(TARGET)
    const lines = rulesFor(cfg.users ?? [])
    const current = Disk.exists(host.disk, dest) ? Disk.text(host.disk, dest) : null
    if (lines.length === 0) {
      if (current === null) return []
      return [{ type: 'file', id: TARGET, field: 'exists', expected: false, actual: true }]
    }
    const want = render(lines)
    if (current === want) return []
    return [
      {
        type: 'file',
        id: TARGET,
        field: 'content',
        expected: sha(want),
        actual: current === null ? null : sha(current),
      },
    ]
  }

  export async function all(host: Host): Promise<void> {
    const cfg = Tree.maybe(host)
    if (!cfg) return
    if ((await plan(host)).length === 0) return
    const dest = host.paths.host(TARGET)
    const lines = rulesFor(cfg.users ?? [])

    if (lines.length === 0) {
      host.disk.remove(dest)
      host.log.info({ dest }, 'sudoers: removed (no sudo users)')
      return
    }

    host.disk.mkdir(path.dirname(dest))
    const tmp = `${dest}.tmp`
    host.disk.write(tmp, render(lines), 0o440)

    const check = await host.exec(['visudo', '-cf', tmp])
    if (check.code !== 0) {
      host.log.error(
        { exitCode: check.code, stderr: check.stderr.trim() },
        'sudoers: visudo validation failed; not applying',
      )
      host.disk.remove(tmp)
      return
    }

    host.disk.chmod(tmp, 0o440)
    host.disk.rename(tmp, dest)
    host.log.info({ dest, users: lines.length }, 'sudoers: wrote')
  }

  export const claims = (): Claims => ({
    exact: [path.join('/', TARGET)],
    prefixes: [],
  })
}
