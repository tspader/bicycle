import type { BicycleConfig, Diff } from '@bicycle/shared'
import type { Host } from '@bicycle/core/host'
import { Tree } from '@bicycle/core/tree'

export namespace Systemd {
  type Manager = { type: string; flags: string[]; prefix: string }

  type Target = { manager: Manager; units: string[] }

  type UnitFile = { unit_file: string; state: string; preset: string | null }

  type Observed = {
    manager: Manager
    units: { unit: string; enabled: boolean; active: boolean }[]
    undeclared: UnitFile[]
  }

  const SYSTEM: Manager = { type: 'unit', flags: [], prefix: '' }

  const targets = (cfg: BicycleConfig): Target[] => [
    { manager: SYSTEM, units: cfg.systemd?.enable ?? [] },
    ...Object.entries(cfg.systemd?.users ?? {}).map(([user, u]) => ({
      manager: { type: 'user-unit', flags: ['--user', '-M', `${user}@`], prefix: `${user}/` },
      units: u.enable ?? [],
    })),
  ]

  const systemctl = (host: Host, m: Manager, args: string[]) => host.exec(['systemctl', ...m.flags, ...args])

  function listed(stdout: string): UnitFile[] {
    try {
      return JSON.parse(stdout) as UnitFile[]
    } catch {
      return []
    }
  }

  async function observe(host: Host, t: Target): Promise<Observed> {
    const units: Observed['units'] = []
    for (const unit of t.units) {
      units.push({
        unit,
        enabled: (await systemctl(host, t.manager, ['is-enabled', unit])).code === 0,
        active: (await systemctl(host, t.manager, ['is-active', unit])).code === 0,
      })
    }
    const list = await systemctl(host, t.manager, ['list-unit-files', '--state=enabled', '--output=json'])
    const files = list.code === 0 ? listed(list.stdout) : []
    const want = new Set(t.units)
    const undeclared = files.filter((u) => u.state === 'enabled' && u.preset !== 'enabled' && !want.has(u.unit_file))
    return { manager: t.manager, units, undeclared }
  }

  export async function plan(host: Host): Promise<Diff[]> {
    const cfg = Tree.maybe(host)
    if (!cfg) return []
    const diffs: Diff[] = []
    for (const t of targets(cfg)) {
      const o = await observe(host, t)
      const { type, prefix } = o.manager
      for (const u of o.units) {
        if (!u.enabled) diffs.push({ type, id: prefix + u.unit, field: 'enabled', expected: true, actual: false })
        if (!u.active) diffs.push({ type, id: prefix + u.unit, field: 'active', expected: true, actual: false })
      }
      for (const u of o.undeclared) {
        diffs.push({
          type,
          id: prefix + u.unit_file,
          field: 'enabled',
          expected: null,
          actual: true,
          meta: { preset: u.preset },
        })
      }
    }
    return diffs
  }

  export async function all(host: Host): Promise<void> {
    const cfg = Tree.maybe(host)
    if (!cfg) return
    for (const t of targets(cfg)) {
      const o = await observe(host, t)
      const pending = o.units.filter((u) => !u.enabled || !u.active).map((u) => u.unit)
      if (pending.length === 0) continue
      const reload = await systemctl(host, o.manager, ['daemon-reload'])
      if (reload.code !== 0) {
        host.log.warn({ exitCode: reload.code, stderr: reload.stderr.trim() }, 'systemd: daemon-reload failed')
      }
      for (const unit of pending) {
        const id = o.manager.prefix + unit
        host.log.info({ unit: id }, 'systemd: enabling')
        const r = await systemctl(host, o.manager, ['enable', '--now', unit])
        if (r.code !== 0) {
          host.log.error({ unit: id, exitCode: r.code, stderr: r.stderr.trim() }, 'systemd: failed to enable')
          continue
        }
        host.log.info({ unit: id }, 'systemd: enabled')
      }
    }
  }
}
