import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { Signal as Signals, SignalName, defaultSignals } from './signal'

export type App = {
  signals: Signals
  error: string | null
  datastar: boolean
}

export type AppContext = Context<{ Variables: App }>

export function getSignal<K extends SignalName>(c: AppContext, name: K): typeof defaultSignals[K] {
  const signal = c.get('signals')[name] ?? defaultSignals[name]
  return signal as typeof defaultSignals[K]
}

export function parseSignals<T extends z.ZodTypeAny>(c: AppContext, schema: T): z.infer<T> {
  const err = c.get('error')
  if (err) throw new HTTPException(400, { message: err })
  const parsed = schema.safeParse(c.get('signals'))
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid' })
  }
  return parsed.data
}

export const requiredQuery = (c: AppContext, key: string): string => {
  const v = c.req.query(key)
  if (!v) throw new HTTPException(400, { message: `missing ${key}` })
  return v
}
