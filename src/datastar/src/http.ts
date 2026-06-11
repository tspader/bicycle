import type { Context, MiddlewareHandler } from 'hono'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'

export type App = {
  signals: Record<string, unknown>
  error: string | null
  datastar: boolean
}

export type AppContext = Context<{ Variables: App }>

export const readSignals: MiddlewareHandler<{ Variables: App }> = async (c, next) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  c.set('signals', r.success ? (r.signals as Record<string, unknown>) : {})
  c.set('error', r.success ? null : r.error)
  c.set('datastar', c.req.raw.headers.get('datastar-request') === 'true')
  await next()
}
