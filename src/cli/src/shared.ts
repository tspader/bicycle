import { z } from 'zod'
import { Clock } from '@bicycle/core/clock'
import type { Reconcilers } from '@bicycle/core/reconcilers'
import type { Client } from '@bicycle/daemon/client'
import { Jobs } from '@bicycle/daemon/jobs'
import { Fail } from '@bicycle/cli/error'
import { Render } from '@bicycle/cli/render'
import type { Sys } from '@bicycle/cli/sys'

export namespace Shared {
  export type Daemon = {
    run: () => void
    once: (only: Reconcilers.Name[]) => Promise<void>
  }

  export type Deps = {
    client: Client
    daemon: Daemon
    clock: Clock
    sys: Sys.Host
  }

  export const POLL = 250

  export function parse<T>(schema: z.ZodType<T>, argv: Record<string, unknown>): T {
    const result = schema.safeParse(argv)
    if (result.success) return result.data
    throw new Fail.Error('invalid', { reason: z.prettifyError(result.error) })
  }

  export const guard = (d: Deps, fn: () => Promise<void>): Promise<void> => fn().catch(d.sys.fail)

  export const only = <T>(name: z.ZodType<T>) =>
    z
      .array(z.unknown())
      .default([])
      .transform((list): unknown[] => list.filter((value) => value != null))
      .pipe(z.array(name))

  export const some = <T>(only: T[]): { only?: T[] } => (only.length === 0 ? {} : { only })

  export async function follow(d: Deps, id: string): Promise<Jobs.Job> {
    const seen = { lines: 0 }
    while (true) {
      const job = await d.client.job(id)
      for (const line of job.lines.slice(Math.max(0, seen.lines - job.skipped))) d.sys.print(Render.line(line))
      seen.lines = job.skipped + job.lines.length
      if (Jobs.terminal(job.status)) return job
      if (job.progress !== null) d.sys.status(Render.progress(job.progress))
      await Clock.sleep(d.clock, POLL)
    }
  }

  export function settle(d: Deps, job: Jobs.Job): void {
    d.sys.status('')
    if (job.failure !== null) d.sys.fail(job.failure)
    d.sys.print(Render.job(job))
    d.sys.exit(job.status === 'done' ? 0 : 1)
  }
}
