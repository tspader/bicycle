import { z } from 'zod'
import { DiffSchema } from '@bicycle/shared'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'

export namespace Scans {
  export const Record = z.object({
    detector: z.string().min(1),
    startedAt: z.string(),
    finishedAt: z.string(),
    diffs: z.array(DiffSchema),
  })
  export type Record = z.infer<typeof Record>

  function parse(host: Host, file: string): unknown {
    try {
      return JSON.parse(Disk.text(host.disk, file))
    } catch {
      return null
    }
  }

  export function read(host: Host, detector: string): Record | null {
    const file = host.paths.state.scan(detector)
    if (!Disk.exists(host.disk, file)) return null
    const parsed = Record.safeParse(parse(host, file))
    if (!parsed.success || parsed.data.detector !== detector) return null
    return parsed.data
  }

  export function write(host: Host, record: Record): void {
    host.disk.mkdir(host.paths.state.scans)
    Disk.replace(host.disk, host.paths.state.scan(record.detector), JSON.stringify(record, null, 2) + '\n')
  }
}
