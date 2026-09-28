import { Hono } from 'hono'
import type { Host } from '@bicycle/core/host'
import { Fail } from '@bicycle/daemon/api/error'
import { JobRoutes } from '@bicycle/daemon/api/jobs'
import { PlanRoutes } from '@bicycle/daemon/api/plan'
import { SecretRoutes } from '@bicycle/daemon/api/secrets'
import type { Jobs } from '@bicycle/daemon/jobs'

export namespace Api {
  export function routes(host: Host, queue: Jobs.Queue): Hono {
    return new Hono()
      .onError(Fail.handler)
      .get('/health', (c) => c.json({ ok: true }))
      .route('/plan', PlanRoutes.routes(host))
      .route('/jobs', JobRoutes.routes(host, queue))
      .route('/secrets', SecretRoutes.routes(host))
  }
}
