import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from './http'

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export class Code<T = unknown> {
  declare protected readonly __type: T
  constructor(readonly code: string) {}
}

export class Sig<T> extends Code<T> {
  constructor(readonly name: string) {
    super(`$${name}`)
  }
  set(value: T | Code<T>): Code<void> {
    return new Code(`${this.code} = ${lit(value)}`)
  }
}

const lit = (value: unknown): string =>
  value instanceof Code ? value.code : JSON.stringify(value)

// The escape hatch for raw expressions: literal holes are JSON-encoded (so
// quoting/escaping is structural), Code holes are spliced verbatim. Typed as
// Code<any> since the expression body itself is unchecked.
export const expr = (parts: TemplateStringsArray, ...holes: Array<Code | Json>): Code<any> =>
  new Code(parts.map((part, i) => (i === 0 ? part : lit(holes[i - 1]) + part)).join(''))

// Comma-sequenced so the result stays a single expression and can be embedded
// anywhere a Code can (event handlers, && guards, other seqs).
export const seq = (...steps: Code[]): Code<void> =>
  new Code(`(${steps.map((s) => s.code).join(', ')})`)

export const eq = (a: Code | Json, b: Code | Json): Code<boolean> =>
  new Code(`${lit(a)} === ${lit(b)}`)

export const ne = (a: Code | Json, b: Code | Json): Code<boolean> =>
  new Code(`${lit(a)} !== ${lit(b)}`)

export const not = (value: Code): Code<boolean> => new Code(`!(${value.code})`)

export const when = (cond: Code, then: Code): Code<void> =>
  new Code(`(${cond.code}) && (${then.code})`)

export const get = (url: string): Code<void> => new Code(`@get(${JSON.stringify(url)})`)
export const post = (url: string): Code<void> => new Code(`@post(${JSON.stringify(url)})`)

export type Props = Record<string, string>

export type EventMods = {
  prevent?: boolean
  stop?: boolean
  window?: boolean
  debounceMs?: number
}

const eventKey = (event: string, mods: EventMods = {}): string => {
  let key = `data-on:${event}`
  if (mods.prevent) key += '__prevent'
  if (mods.stop) key += '__stop'
  if (mods.window) key += '__window'
  if (mods.debounceMs != null) key += `__debounce.${mods.debounceMs}ms`
  return key
}

export const on = (event: string, action: Code, mods?: EventMods): Props => ({
  [eventKey(event, mods)]: action.code,
})

export const onInterval = (action: Code, ms: number): Props => ({
  [`data-on-interval__duration.${ms}ms`]: action.code,
})

export const effect = (action: Code): Props => ({ 'data-effect': action.code })
export const show = (cond: Code): Props => ({ 'data-show': cond.code })
export const text = (value: Code): Props => ({ 'data-text': value.code })
export const attr = (name: string, value: Code): Props => ({ [`data-attr:${name}`]: value.code })
export const cls = (name: string, cond: Code): Props => ({ [`data-class:${name}`]: cond.code })
export const bind = <T>(sig: Sig<T>): Props => ({ 'data-bind': sig.name })

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
