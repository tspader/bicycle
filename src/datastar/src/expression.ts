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

export const lit = (value: unknown): string =>
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
