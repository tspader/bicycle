import { Hono } from 'hono'
import { z } from 'zod'
import type { Host } from '@bicycle/core/host'
import { Secrets } from '@bicycle/core/secrets'

export namespace SecretRoutes {
  export const Clear = z.object({ value: z.string() })
  export type Clear = z.infer<typeof Clear>

  export function routes(host: Host): Hono {
    const app = new Hono()
    app.get('/', (c) => c.json(Secrets.list(host)))
    app.get('/:addr{.+}', async (c) => c.json({ value: await Secrets.read(host, c.req.param('addr')) }))
    app.put('/:addr{.+}', async (c) => {
      await Secrets.write(host, c.req.param('addr'), new Uint8Array(await c.req.arrayBuffer()))
      return c.body(null, 204)
    })
    app.delete('/:addr{.+}', (c) => {
      Secrets.remove(host, c.req.param('addr'))
      return c.body(null, 204)
    })
    return app
  }
}
