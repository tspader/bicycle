import { z } from 'zod'
import { Kinds } from '@bicycle/core/kinds'
import type { JobRoutes } from '@bicycle/daemon/api/jobs'
import { SecretRoutes } from '@bicycle/daemon/api/secrets'
import { Jobs } from '@bicycle/daemon/jobs'
import type { Net } from '@bicycle/daemon/net'

export namespace Fail {
  export type Data = {
    http: { method: string; path: string; status: number; reply: string }
    unreachable: { url: string; reason: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    http: (d) => `${d.method} ${d.path} failed with status ${d.status}: ${d.reply}`,
    unreachable: (d) => `no daemon at ${d.url}: ${d.reason}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'ClientError'
    }
  }
}

export interface Client {
  plan: (only: string[]) => Promise<Kinds.Plan>
  submit: (work: JobRoutes.Submit) => Promise<Jobs.Job>
  job: (id: string) => Promise<Jobs.Job>
  jobs: (limit: number) => Promise<Jobs.Job[]>
  secrets: () => Promise<string[]>
  secret: (addr: string) => Promise<string>
  seal: (addr: string, clear: Uint8Array) => Promise<void>
  forget: (addr: string) => Promise<void>
}

export function Client(url: string, net: Net): Client {
  const call = async (method: string, path: string, ask: Omit<Net.Ask, 'method'> = {}): Promise<Response> => {
    const res = await net.fetch(`${url}${path}`, { method, ...ask }).catch((error: Error) => {
      throw new Fail.Error('unreachable', { url, reason: error.message })
    })
    if (!res.ok) throw new Fail.Error('http', { method, path, status: res.status, reply: await res.text() })
    return res
  }

  const get = async <T>(path: string, schema: z.ZodType<T>): Promise<T> =>
    schema.parse(await (await call('GET', path)).json())

  const at = (addr: string): string => `/api/secrets/${addr.split('/').map(encodeURIComponent).join('/')}`

  return {
    plan: (only) =>
      get(`/api/plan?${new URLSearchParams(only.map((name): [string, string] => ['only', name]))}`, Kinds.Plan),
    submit: async (work) => {
      const res = await call('POST', '/api/jobs', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(work),
      })
      return Jobs.Job.parse(await res.json())
    },
    job: (id) => get(`/api/jobs/${encodeURIComponent(id)}`, Jobs.Job),
    jobs: (limit) => get(`/api/jobs?limit=${limit}`, z.array(Jobs.Job)),
    secrets: () => get('/api/secrets', z.array(z.string())),
    secret: async (addr) => (await get(at(addr), SecretRoutes.Clear)).value,
    seal: async (addr, clear) => {
      await call('PUT', at(addr), { headers: { 'content-type': 'application/octet-stream' }, body: clear })
    },
    forget: async (addr) => {
      await call('DELETE', at(addr))
    },
  }
}
