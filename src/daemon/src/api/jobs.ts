import { Hono } from 'hono'
import { z } from 'zod'
import { Detect } from '@bicycle/core/detect'
import type { Host } from '@bicycle/core/host'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { Fail } from '@bicycle/daemon/api/error'
import { Jobs } from '@bicycle/daemon/jobs'

export namespace JobRoutes {
  export const Submit = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('reconcile'), only: z.array(Reconcilers.Name).min(1).optional() }),
    z.object({
      kind: z.literal('scan'),
      only: z.array(z.string()).min(1).optional(),
      priority: Detect.Priority.default('idle'),
      timeout: z.number().int().positive().default(Detect.TIMEOUT),
    }),
  ])
  export type Submit = z.input<typeof Submit>

  export const List = z.object({ limit: z.coerce.number().int().positive().max(Jobs.KEPT).default(20) })

  export function work(host: Host, asked: z.infer<typeof Submit>): Jobs.Work {
    switch (asked.kind) {
      case 'reconcile':
        return { kind: 'reconcile', only: asked.only ?? [...Reconcilers.ORDER] }
      case 'scan': {
        const known = Detect.detectors(host).map((det) => det.name)
        const only = asked.only ?? known
        Fail.known(only, known)
        return { kind: 'scan', only, priority: asked.priority, timeout: asked.timeout }
      }
    }
  }

  export function routes(host: Host, queue: Jobs.Queue): Hono {
    const app = new Hono()
    app.get('/', (c) => c.json(Jobs.recent(queue, Fail.parse(List, c.req.query()).limit)))
    app.post('/', async (c) => {
      const asked = Fail.parse(Submit, await Fail.json(c))
      return c.json(Jobs.submit(queue, work(host, asked), 'api', 0), 202)
    })
    app.get('/:id', (c) => {
      const id = c.req.param('id')
      const job = Jobs.find(queue, id)
      if (job === undefined) throw new Fail.Error('no-job', { id })
      return c.json(job)
    })
    return app
  }
}
