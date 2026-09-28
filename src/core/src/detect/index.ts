import path from 'path'
import { z } from 'zod'
import { ignore, type Detector } from '@bicycle/shared'
import { Claims } from '@bicycle/core/detect/claims'
import { Exec } from '@bicycle/core/detect/exec'
import { Scans } from '@bicycle/core/detect/scans'
import type { Host } from '@bicycle/core/host'
import { Tree } from '@bicycle/core/tree'

export namespace Detect {
  export const FS = 'fs'
  export const TIMEOUT = Exec.TIMEOUT

  function declared(host: Host): Detector[] {
    try {
      return Tree.maybe(host)?.detectors ?? []
    } catch (e) {
      host.log.error({ err: e }, 'detect: cannot read detectors from bicycle.yml; skipping configured detectors')
      return []
    }
  }

  export function detectors(host: Host): Detector[] {
    const out: Detector[] = [{ name: FS, exec: [host.paths.scanner] }]
    for (const det of declared(host)) {
      if (out.some((d) => d.name === det.name)) {
        host.log.warn({ detector: det.name }, 'detector name collides with another; skipping')
        continue
      }
      out.push(det)
    }
    return out
  }

  export const prunes = (cfg: ignore.IgnoreConfig): string =>
    ignore
      .prunesOf(cfg.files)
      .map((p) => `${p}\n`)
      .join('')

  export const Priority = z.enum(['idle', 'full'])
  export type Priority = z.infer<typeof Priority>

  export const Progress = Exec.Progress.omit({ t: true }).extend({ detector: z.string() })
  export type Progress = z.infer<typeof Progress>

  export type Scan = {
    detectors: Detector[]
    ignores: ignore.IgnoreConfig
    claims: Claims
    priority: Priority
    timeout: number
    progress: (progress: Progress) => void
  }

  export const Outcome = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('scanned'), detector: z.string(), findings: z.number() }),
    z.object({ kind: z.literal('failed'), detector: z.string(), message: z.string() }),
  ])
  export type Outcome = z.infer<typeof Outcome>

  const priorities: Record<Priority, Record<string, string>> = {
    idle: { BICYCLE_BACKGROUND: '1' },
    full: {},
  }

  async function one(host: Host, det: Detector, scan: Scan, env: Record<string, string>): Promise<Outcome> {
    const cache = host.paths.state.detector(det.name)
    host.disk.mkdir(cache)
    const started = host.clock.now().toISOString()
    try {
      const res = await Exec.run(host, det, {
        env: { ...env, BICYCLE_CACHE_DIR: cache },
        timeout: scan.timeout,
        grace: Exec.GRACE,
        progress: ({ t, ...p }) => scan.progress({ detector: det.name, ...p }),
      })
      Scans.write(host, {
        detector: det.name,
        startedAt: started,
        finishedAt: host.clock.now().toISOString(),
        diffs: res.diffs,
      })
      return { kind: 'scanned', detector: det.name, findings: res.diffs.length }
    } catch (e) {
      host.log.error({ err: e, detector: det.name }, 'scan: detector failed; previous scan kept')
      return { kind: 'failed', detector: det.name, message: e instanceof Error ? e.message : String(e) }
    }
  }

  export async function scan(host: Host, scan: Scan): Promise<Outcome[]> {
    host.disk.mkdir(path.dirname(host.paths.run.prunes))
    host.disk.write(host.paths.run.prunes, prunes(scan.ignores))
    const env = {
      BICYCLE_PRUNES: host.paths.run.prunes,
      BICYCLE_CLAIMS: Claims.write(host, scan.claims),
      ...priorities[scan.priority],
    }
    const outcomes: Outcome[] = []
    for (const det of scan.detectors) outcomes.push(await one(host, det, scan, env))
    return outcomes
  }
}
