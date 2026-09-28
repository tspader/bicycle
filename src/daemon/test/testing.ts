import { Testing as Core } from '@bicycle/core/testing'
import { Jobs } from '@bicycle/daemon/jobs'
import type { Net } from '@bicycle/daemon/net'

export namespace Testing {
  export const each = Core.each
  export const within = Core.within
  export const outcome = Core.outcome
  export const config = Core.config
  export const runActions = Core.runActions
  export const levels = Core.levels
  export const drive = Core.drive
  export const time = Core.time
  export const put = Core.put
  export const text = Core.text
  export const node = Core.node
  export const epoch = Core.epoch

  export type World = Core.World
  export type Time = Core.Time
  export type Action = Core.Action

  export function ids(): () => string {
    const state = { next: 0 }
    return () => {
      const n = state.next++
      return String.fromCharCode(65 + (n % 26)).repeat(1 + Math.floor(n / 26))
    }
  }

  export type Started = { id: string; work: Jobs.Work }

  export type Bench = { queue: Jobs.Queue; clock: Time; worker: Jobs.Worker; started: Started[] }

  export function bench(): Bench {
    const clock = time()
    const started: Started[] = []
    return {
      queue: Jobs.create(clock.clock.now, ids()),
      clock,
      worker: { start: (id, work) => started.push({ id, work }) },
      started,
    }
  }

  export type Reply = { status: number; body: unknown }
  export type Hit = { method: string; path: string; body: string }
  export type Wire = { url: string; net: Net; hits: Hit[] }

  const ORIGIN = 'http://D'

  const said = (body: string | Uint8Array | undefined): string =>
    body === undefined ? '' : typeof body === 'string' ? body : new TextDecoder().decode(body)

  export function net(replies: Reply[] | 'down'): Wire {
    const hits: Hit[] = []
    return {
      url: ORIGIN,
      hits,
      net: {
        fetch: async (url, ask) => {
          if (replies === 'down') throw new Error('Unable to connect')
          const reply = replies[Math.min(hits.length, replies.length - 1)]!
          const asked = new URL(url)
          hits.push({ method: ask.method, path: asked.pathname + asked.search, body: said(ask.body) })
          return reply.body === null
            ? new Response(null, { status: reply.status })
            : Response.json(reply.body, { status: reply.status })
        },
      },
    }
  }

  export const job = (id: string, rest: Partial<Jobs.Job> = {}): Jobs.Job => ({
    id,
    work: { kind: 'reconcile', only: ['files'] },
    trigger: 'api',
    status: 'queued',
    created: new Date(epoch).toISOString(),
    ready: new Date(epoch).toISOString(),
    started: null,
    finished: null,
    lines: [],
    skipped: 0,
    progress: null,
    outcomes: [],
    failure: null,
    ...rest,
  })
}
