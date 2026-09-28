import { ignore, yamledit, type Diff } from '@bicycle/shared'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'

export namespace Ignores {
  export type Entry =
    { section: 'files' | 'packages' | 'units'; value: string } | { section: 'diffs'; value: ignore.IgnoreRule }

  export function entry(d: Diff): Entry {
    if (d.type === 'stray' || d.type === 'pacman-file') return { section: 'files', value: d.id }
    if (d.type === 'package' && d.expected === null) return { section: 'packages', value: d.id }
    if (d.type === 'unit' && d.expected === null) return { section: 'units', value: d.id }
    return { section: 'diffs', value: { type: d.type, id: d.id, field: d.field } }
  }

  const text = (host: Host): string =>
    Disk.exists(host.disk, host.paths.etc.ignore) ? Disk.text(host.disk, host.paths.etc.ignore) : ''

  export const effective = (host: Host): ignore.IgnoreConfig => ignore.merge(ignore.DEFAULTS, ignore.parse(text(host)))

  function has(cfg: ignore.IgnoreConfig, e: Entry): boolean {
    if (e.section !== 'diffs') return cfg[e.section].includes(e.value)
    return cfg.diffs.some(
      (r) => r.type === e.value.type && r.id === e.value.id && (r.field ?? null) === (e.value.field ?? null),
    )
  }

  export function add(host: Host, e: Entry): boolean {
    const current = text(host)
    if (has(ignore.parse(current), e)) return false
    const next =
      e.section === 'diffs'
        ? yamledit.append(current, ['diffs'], e.value, 'flow')
        : yamledit.append(current, [e.section], e.value, 'block')
    host.disk.write(host.paths.etc.ignore, next)
    Disk.adopt(host.disk, host.paths.etc.ignore)
    return true
  }
}
