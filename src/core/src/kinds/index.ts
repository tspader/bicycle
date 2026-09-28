import { z } from 'zod'
import { DiffSchema, ignore, type Detector, type Diff } from '@bicycle/shared'
import { Detect } from '@bicycle/core/detect'
import type { Claims } from '@bicycle/core/detect/claims'
import { Scans } from '@bicycle/core/detect/scans'
import type { Host } from '@bicycle/core/host'
import { Ignores } from '@bicycle/core/ignores'
import { Dirs } from '@bicycle/core/reconcilers/dirs'
import { Files } from '@bicycle/core/reconcilers/files'
import { Groups } from '@bicycle/core/reconcilers/groups'
import { Ingress } from '@bicycle/core/reconcilers/ingress'
import { Packages } from '@bicycle/core/reconcilers/packages'
import { Sudoers } from '@bicycle/core/reconcilers/sudoers'
import { Systemd } from '@bicycle/core/reconcilers/systemd'
import { Users } from '@bicycle/core/reconcilers/users'

export namespace Kinds {
  export type Kind = {
    name: string
    plan: (host: Host) => Promise<Diff[]>
    claims: (host: Host) => Claims
    scanned?: (host: Host) => string | null
  }

  const none = (): Claims => ({ exact: [], prefixes: [] })

  const BUILTIN: Kind[] = [
    { name: 'groups', plan: Groups.plan, claims: none },
    { name: 'users', plan: Users.plan, claims: none },
    { name: 'sudoers', plan: Sudoers.plan, claims: Sudoers.claims },
    { name: 'dirs', plan: Dirs.plan, claims: Dirs.claims },
    { name: 'files', plan: Files.plan, claims: Files.claims },
    { name: 'packages', plan: Packages.plan, claims: none },
    { name: 'systemd', plan: Systemd.plan, claims: none },
    { name: 'ingress', plan: Ingress.plan, claims: Ingress.claims },
  ]

  const detected = (det: Detector): Kind => ({
    name: det.name,
    plan: async (host) => Scans.read(host, det.name)?.diffs ?? [],
    claims: none,
    scanned: (host) => Scans.read(host, det.name)?.finishedAt ?? null,
  })

  export const all = (host: Host): Kind[] => [
    ...BUILTIN,
    ...Detect.detectors(host)
      .filter((det) => !BUILTIN.some((k) => k.name === det.name))
      .map(detected),
  ]

  export const names = (host: Host): string[] => all(host).map((k) => k.name)

  function claimed(host: Host, kind: Kind): Claims {
    try {
      return kind.claims(host)
    } catch (e) {
      host.log.warn({ err: e, kind: kind.name }, 'kinds: claims unavailable')
      return none()
    }
  }

  export function claims(host: Host): Claims {
    const found = all(host).map((kind) => claimed(host, kind))
    const exact = new Set(found.flatMap((c) => c.exact))
    const prefixes = new Set([host.paths.etc.root, host.paths.state.root, ...found.flatMap((c) => c.prefixes)])
    return { exact: [...exact].sort(), prefixes: [...prefixes].sort() }
  }

  export const Planned = z.object({
    kind: z.string(),
    diffs: z.array(DiffSchema),
    scannedAt: z.string().nullable().optional(),
  })
  export type Planned = z.infer<typeof Planned>

  export const Plan = z.object({
    kinds: z.array(Planned),
    diffs: z.array(DiffSchema),
    ignored: z.number(),
  })
  export type Plan = z.infer<typeof Plan>

  export async function plan(host: Host, only: readonly string[]): Promise<Plan> {
    const matcher = ignore.compile(Ignores.effective(host))
    const kinds: Planned[] = []
    const state = { ignored: 0 }
    for (const k of all(host).filter((k) => only.includes(k.name))) {
      const found = await k.plan(host)
      const diffs = found.filter((d) => !matcher.ignores(d))
      state.ignored += found.length - diffs.length
      kinds.push({ kind: k.name, diffs, ...(k.scanned ? { scannedAt: k.scanned(host) } : {}) })
    }
    return { kinds, diffs: kinds.flatMap((e) => e.diffs), ignored: state.ignored }
  }
}
