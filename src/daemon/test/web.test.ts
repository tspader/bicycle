import { expect } from 'bun:test'
import type { Diff } from '@bicycle/shared'
import { Detect } from '@bicycle/core/detect'
import { Jobs } from '@bicycle/daemon/jobs'
import { Testing } from '@bicycle/daemon/testing'
import { Web } from '@bicycle/daemon/web'

type Call = { method: 'GET' | 'POST'; path: string; signals?: Record<string, unknown> }

type Case = {
  name: string
  config: unknown
  calls: Call[]
  expect: {
    status: number
    location?: string
    ignore?: string
    jobs?: Pick<Jobs.Job, 'work' | 'trigger' | 'status'>[]
  }
}

const P = 'definitely-not-a-real-package-9b3c'
const config = { packages: { extra: [P] } }
const missing: Diff = { type: 'package', id: P, field: 'installed', expected: true, actual: false }

const get = (path: string): Call => ({ method: 'GET', path })
const post = (path: string, signals: Record<string, unknown> = {}): Call => ({ method: 'POST', path, signals })
const pick = (diff: Diff): Call => post(`/select?id=${encodeURIComponent(key(diff))}`)
const key = (d: Diff): string => 'd-' + Buffer.from(`${d.type} ${d.id} ${d.field}`).toString('base64url')

const cases: Case[] = [
  { name: 'the hosts page', config, calls: [get('/')], expect: { status: 200 } },
  { name: 'the diff page', config, calls: [get('/diff')], expect: { status: 200 } },
  { name: 'the page of one kind', config, calls: [get('/diff/packages')], expect: { status: 200 } },
  {
    name: 'the page of what is not a kind',
    config,
    calls: [get('/diff/Z')],
    expect: { status: 302, location: '/diff' },
  },
  { name: 'a stylesheet', config, calls: [get('/static/diff.css')], expect: { status: 200 } },
  {
    name: 'ignoring one row writes the ignore file',
    config,
    calls: [post('/resolve?kind=packages', { diff: JSON.stringify(missing) })],
    expect: { status: 200, ignore: `diffs:\n  - {type: package, id: ${P}, field: installed}\n` },
  },
  {
    name: 'ignoring a row that is not a diff',
    config,
    calls: [post('/resolve?kind=packages', { diff: 'Z' })],
    expect: { status: 400 },
  },
  {
    name: 'ignoring the selection writes the ignore file',
    config,
    calls: [get('/diff'), pick(missing), post('/bulk-ignore')],
    expect: { status: 200, ignore: `diffs:\n  - {type: package, id: ${P}, field: installed}\n` },
  },
  {
    name: 'applying a kind is a job for the daemon',
    config,
    calls: [post('/apply?kind=packages')],
    expect: {
      status: 200,
      jobs: [{ work: { kind: 'reconcile', only: ['packages'] }, trigger: 'web', status: 'done' }],
    },
  },
  {
    name: 'a kind that only detects cannot be applied',
    config,
    calls: [post('/apply?kind=fs')],
    expect: { status: 400, jobs: [] },
  },
  {
    name: 'a scan is a job for the daemon',
    config,
    calls: [post('/scan')],
    expect: {
      status: 200,
      jobs: [
        {
          work: { kind: 'scan', only: ['fs'], priority: 'idle', timeout: Detect.TIMEOUT },
          trigger: 'web',
          status: 'done',
        },
      ],
    },
  },
]

const TICK = 5

Testing.each('Web.routes', cases, (it) =>
  Testing.within(async (w) => {
    Testing.config(w, it.config)
    const { clock } = w.host
    const queue = Jobs.create(clock.now, Testing.ids())
    const worker: Jobs.Worker = { start: (id) => Jobs.push(queue, { kind: 'ended', id, outcomes: [] }) }
    const tick = (): void => {
      Jobs.tick(queue, worker)
      clock.after(TICK, tick)
    }
    tick()
    const app = Web.routes(w.host, queue)
    const ask = async (call: Call): Promise<Response> => {
      const res = await app.request(call.path, {
        method: call.method,
        headers: { 'datastar-request': 'true', 'content-type': 'application/json' },
        ...(call.method === 'POST' ? { body: JSON.stringify(call.signals ?? {}) } : {}),
      })
      await res.text()
      return res
    }
    const replies: Response[] = []
    for (const call of it.calls) replies.push(await Testing.drive(w.time, ask(call)))
    const last = replies.at(-1)!
    expect(last.status).toBe(it.expect.status)
    if (it.expect.location !== undefined) expect(last.headers.get('location')).toBe(it.expect.location)
    if (it.expect.ignore !== undefined) expect(Testing.text(w, w.host.paths.etc.ignore)).toBe(it.expect.ignore)
    if (it.expect.jobs) expect(queue.jobs).toMatchObject(it.expect.jobs)
    if (it.expect.jobs) expect(queue.jobs).toHaveLength(it.expect.jobs.length)
  }),
)
