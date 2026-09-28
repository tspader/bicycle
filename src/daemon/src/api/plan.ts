import { Hono } from 'hono'
import type { Host } from '@bicycle/core/host'
import { Kinds } from '@bicycle/core/kinds'
import { Fail } from '@bicycle/daemon/api/error'

export namespace PlanRoutes {
  export function routes(host: Host): Hono {
    const app = new Hono()
    app.get('/', async (c) => {
      const known = Kinds.names(host)
      const only = c.req.queries('only') ?? known
      Fail.known(only, known)
      return c.json(await Kinds.plan(host, only))
    })
    return app
  }
}
