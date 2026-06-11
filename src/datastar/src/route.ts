import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { type Code, get, post } from './expression'
import type { AppContext } from './http'

type Method = 'get' | 'post'

export type PlainRoute = {
  method: Method
  path: string
  url: () => string
  action: () => Code<void>
}

export type ParamRoute<S extends z.ZodRawShape> = {
  method: Method
  path: string
  url: (params: z.input<z.ZodObject<S>>) => string
  action: (params: z.input<z.ZodObject<S>>) => Code<void>
  params: (c: AppContext) => z.output<z.ZodObject<S>>
}

const actions = { get, post }

export function route(method: Method, path: string): PlainRoute
export function route<S extends z.ZodRawShape>(method: Method, path: string, query: S): ParamRoute<S>
export function route(method: Method, path: string, query?: z.ZodRawShape) {
  if (!query) {
    return { method, path, url: () => path, action: () => actions[method](path) }
  }
  const schema = z.object(query)
  const url = (params: Record<string, unknown>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value))
    }
    const s = qs.toString()
    return s ? `${path}?${s}` : path
  }
  return {
    method,
    path,
    url,
    action: (params: Record<string, unknown>) => actions[method](url(params)),
    params: (c: AppContext) => {
      const parsed = schema.safeParse(c.req.query())
      if (!parsed.success) {
        throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid query' })
      }
      return parsed.data
    },
  }
}
