import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'
import { Fail as Age } from '@bicycle/core/age'
import { Fail as Secrets } from '@bicycle/core/secrets'

export namespace Fail {
  export type Data = {
    invalid: { issues: z.core.$ZodIssue[] }
    'bad-json': { reason: string }
    'no-job': { id: string }
    unknown: { names: string[]; known: string[] }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    invalid: (d) => d.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    'bad-json': (d) => `the body is not JSON: ${d.reason}`,
    'no-job': (d) => `no job ${d.id}`,
    unknown: (d) => `unknown: ${d.names.join(', ')}; known: ${d.known.join(', ')}`,
  }

  const statuses: Record<Kind, ContentfulStatusCode> = {
    invalid: 400,
    'bad-json': 400,
    'no-job': 404,
    unknown: 400,
  }

  const core: Record<Secrets.Kind | Age.Kind, ContentfulStatusCode> = {
    'bad-addr': 400,
    empty: 400,
    'no-secret': 404,
    'no-recipients': 409,
    'no-key': 409,
    undecryptable: 409,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'ApiError'
    }
  }

  export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value)
    if (result.success) return result.data
    throw new Error('invalid', { issues: result.error.issues })
  }

  export const json = (c: Context): Promise<unknown> =>
    c.req.json().catch((error: globalThis.Error) => {
      throw new Error('bad-json', { reason: error.message })
    })

  export function known(names: string[], known: string[]): void {
    const strange = names.filter((name) => !known.includes(name))
    if (strange.length > 0) throw new Error('unknown', { names: strange, known })
  }

  export function handler(error: globalThis.Error, c: Context): Response {
    if (error instanceof Secrets.Error || error instanceof Age.Error) {
      const fail: Secrets.Error | Age.Error = error
      return c.json({ error: fail.kind, ...fail.data }, core[fail.kind])
    }
    if (!(error instanceof Error)) throw error
    const fail: Error = error
    return c.json({ error: fail.kind, ...fail.data }, statuses[fail.kind])
  }
}
