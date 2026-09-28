import { z } from 'zod'
import { Detect } from '@bicycle/core/detect'
import { Log } from '@bicycle/core/log'
import { Reconcilers } from '@bicycle/core/reconcilers'

export namespace Jobs {
  export const Work = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('reconcile'), only: z.array(Reconcilers.Name) }),
    z.object({ kind: z.literal('app'), name: z.string() }),
    z.object({
      kind: z.literal('scan'),
      only: z.array(z.string()),
      priority: Detect.Priority,
      timeout: z.number(),
    }),
  ])
  export type Work = z.infer<typeof Work>

  export const Trigger = z.enum(['boot', 'watch', 'api', 'web'])
  export type Trigger = z.infer<typeof Trigger>

  export const Status = z.enum(['queued', 'running', 'done', 'failed'])
  export type Status = z.infer<typeof Status>

  export const Job = z.object({
    id: z.string(),
    work: Work,
    trigger: Trigger,
    status: Status,
    created: z.string(),
    ready: z.string(),
    started: z.string().nullable(),
    finished: z.string().nullable(),
    lines: z.array(Log.Line),
    skipped: z.number(),
    progress: Detect.Progress.nullable(),
    outcomes: z.array(Detect.Outcome),
    failure: z.string().nullable(),
  })
  export type Job = z.infer<typeof Job>

  export type Message =
    | { kind: 'line'; id: string; line: Log.Line }
    | { kind: 'progress'; id: string; progress: Detect.Progress }
    | { kind: 'ended'; id: string; outcomes: Detect.Outcome[] }
    | { kind: 'failed'; id: string; message: string }

  export type Worker = { start: (id: string, work: Work) => void }

  export type Queue = {
    jobs: Job[]
    inbox: Message[]
    now: () => Date
    id: () => string
  }

  export const KEPT = 100
  export const LINES = 1000

  export const create = (now: () => Date, id: () => string): Queue => ({ jobs: [], inbox: [], now, id })

  export const terminal = (status: Status): boolean => status === 'done' || status === 'failed'

  const lanes: Record<Work['kind'], 'apply' | 'scan'> = { reconcile: 'apply', app: 'apply', scan: 'scan' }

  function canonical(work: Work): Work {
    switch (work.kind) {
      case 'reconcile':
        return { ...work, only: Reconcilers.ORDER.filter((name) => work.only.includes(name)) }
      case 'app':
        return work
      case 'scan':
        return { ...work, only: [...new Set(work.only)].sort() }
    }
  }

  const later = (a: string, b: string): string => (Date.parse(a) > Date.parse(b) ? a : b)

  export function submit(queue: Queue, asked: Work, trigger: Trigger, delay: number): Job {
    const work = canonical(asked)
    const now = queue.now()
    const ready = new Date(now.getTime() + delay).toISOString()
    const same = JSON.stringify(work)
    const waiting = queue.jobs.find((job) => job.status === 'queued' && JSON.stringify(job.work) === same)
    if (waiting !== undefined) {
      waiting.ready = later(waiting.ready, ready)
      return waiting
    }
    const job: Job = {
      id: queue.id(),
      work,
      trigger,
      status: 'queued',
      created: now.toISOString(),
      ready,
      started: null,
      finished: null,
      lines: [],
      skipped: 0,
      progress: null,
      outcomes: [],
      failure: null,
    }
    queue.jobs.push(job)
    return job
  }

  export const find = (queue: Queue, id: string): Job | undefined => queue.jobs.find((job) => job.id === id)

  export const recent = (queue: Queue, limit: number): Job[] => queue.jobs.slice(-limit).reverse()

  export function push(queue: Queue, message: Message): void {
    queue.inbox.push(message)
  }

  function finish(job: Job, now: Date, failure: string | null): void {
    const clean = failure === null && !job.lines.some((line) => line.level === 'error')
    job.status = clean ? 'done' : 'failed'
    job.finished = now.toISOString()
    job.failure = failure
    job.progress = null
  }

  function apply(job: Job, message: Message, now: Date): void {
    switch (message.kind) {
      case 'line':
        job.lines.push(message.line)
        job.skipped += job.lines.splice(0, Math.max(0, job.lines.length - LINES)).length
        return
      case 'progress':
        job.progress = message.progress
        return
      case 'ended':
        job.outcomes = message.outcomes
        finish(job, now, null)
        return
      case 'failed':
        finish(job, now, message.message)
        return
    }
  }

  export function tick(queue: Queue, worker: Worker): void {
    const now = queue.now()
    for (const message of queue.inbox.splice(0)) {
      const job = find(queue, message.id)
      if (job !== undefined && job.status === 'running') apply(job, message, now)
    }
    for (const lane of new Set(Object.values(lanes))) {
      const mine = queue.jobs.filter((job) => lanes[job.work.kind] === lane)
      if (mine.some((job) => job.status === 'running')) continue
      const next = mine.find((job) => job.status === 'queued' && Date.parse(job.ready) <= now.getTime())
      if (next === undefined) continue
      next.status = 'running'
      next.started = now.toISOString()
      worker.start(next.id, next.work)
    }
    const done = queue.jobs.filter((job) => terminal(job.status))
    const dropped = new Set(done.slice(0, Math.max(0, queue.jobs.length - KEPT)).map((job) => job.id))
    queue.jobs = queue.jobs.filter((job) => !dropped.has(job.id))
  }
}
