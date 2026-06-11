import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { Sig, type Json } from './expression'
import type { Props } from './attributes'
import type { AppContext } from './http'

export type SignalGroup<S extends z.ZodRawShape> = {
  $: { [K in keyof S]: Sig<z.output<S[K]>> }
  seed: (values: z.input<z.ZodObject<S>>) => Props
  patch: (values: Partial<z.input<z.ZodObject<S>>>) => Record<string, Json>
  read: (c: AppContext) => z.output<z.ZodObject<S>>
  peek: (c: AppContext) => z.output<z.ZodObject<S>>
}

export const signals = <S extends z.ZodRawShape>(shape: S, prefix = ''): SignalGroup<S> => {
  const schema = z.object(shape)
  const names = Object.keys(shape)
  const sigs = Object.fromEntries(names.map((n) => [n, new Sig(prefix + n)]))
  const prefixed = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [prefix + k, v])) as Record<string, Json>
  const pick = (raw: Record<string, unknown>) =>
    Object.fromEntries(names.map((n) => [n, raw[prefix + n]]))
  return {
    $: sigs as SignalGroup<S>['$'],
    seed: (values) => ({ 'data-signals': JSON.stringify(prefixed(values)) }),
    patch: (values) => prefixed(values),
    read: (c) => {
      const err = c.get('error')
      if (err) throw new HTTPException(400, { message: err })
      const parsed = schema.safeParse(pick(c.get('signals')))
      if (!parsed.success) {
        throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid signals' })
      }
      return parsed.data
    },
    // Page bodies render on direct navigation too, where no request signals
    // exist; fall back to the group's defaults instead of rejecting.
    peek: (c) => {
      const raw = c.get('error') ? {} : c.get('signals')
      const parsed = schema.safeParse(pick(raw))
      return parsed.success ? parsed.data : schema.parse({})
    },
  }
}
