import { expect } from 'bun:test'
import { z } from 'zod'
import { Detect } from '@bicycle/core/detect'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { Api } from '@bicycle/daemon/api'
import { Jobs } from '@bicycle/daemon/jobs'
import { Testing } from '@bicycle/daemon/testing'

type Call = { method: 'GET' | 'POST'; path: string; body?: string }

type Case = {
  name: string
  before?: Jobs.Work[]
  call: Call
  expect: { status: number; body: unknown; queued?: Jobs.Work[] }
}

const files: Jobs.Work = { kind: 'reconcile', only: ['files'] }
const users: Jobs.Work = { kind: 'reconcile', only: ['users'] }
const every: Jobs.Work = { kind: 'reconcile', only: [...Reconcilers.ORDER] }
const scan: Jobs.Work = { kind: 'scan', only: ['fs'], priority: 'idle', timeout: Detect.TIMEOUT }

const post = (body: unknown): Call => ({ method: 'POST', path: '/jobs', body: JSON.stringify(body) })
const get = (path: string): Call => ({ method: 'GET', path })
const job = (id: string, work: Jobs.Work) => Testing.job(id, { work })
const invalid = (paths: string[][]) => ({ status: 400, body: { error: 'invalid', paths } })

const cases: Case[] = [
  {
    name: 'a reconcile of everything',
    call: post({ kind: 'reconcile' }),
    expect: { status: 202, body: job('A', every), queued: [every] },
  },
  {
    name: 'a reconcile of some',
    call: post({ kind: 'reconcile', only: ['files'] }),
    expect: { status: 202, body: job('A', files), queued: [files] },
  },
  {
    name: 'a reconcile of what is not a reconciler',
    call: post({ kind: 'reconcile', only: ['Z'] }),
    expect: { ...invalid([['only', '0']]), queued: [] },
  },
  {
    name: 'a scan of every detector at idle priority',
    call: post({ kind: 'scan' }),
    expect: { status: 202, body: job('A', scan), queued: [scan] },
  },
  {
    name: 'a scan with a priority and a timeout',
    call: post({ kind: 'scan', only: ['fs'], priority: 'full', timeout: 5 }),
    expect: {
      status: 202,
      body: job('A', { ...scan, priority: 'full', timeout: 5 }),
      queued: [{ ...scan, priority: 'full', timeout: 5 }],
    },
  },
  {
    name: 'a scan of what is not a detector',
    call: post({ kind: 'scan', only: ['Z'] }),
    expect: { status: 400, body: { error: 'unknown', names: ['Z'], known: ['fs'] }, queued: [] },
  },
  {
    name: 'work the api does not take',
    call: post({ kind: 'app', name: 'A' }),
    expect: { ...invalid([['kind']]), queued: [] },
  },
  {
    name: 'a body that is not JSON',
    call: { method: 'POST', path: '/jobs', body: 'Z' },
    expect: { status: 400, body: { error: 'bad-json' }, queued: [] },
  },
  {
    name: 'the jobs, newest first',
    before: [files, users],
    call: get('/jobs'),
    expect: { status: 200, body: [job('B', users), job('A', files)] },
  },
  {
    name: 'the jobs, up to a limit',
    before: [files, users],
    call: get('/jobs?limit=1'),
    expect: { status: 200, body: [job('B', users)] },
  },
  { name: 'a limit that is not one', call: get('/jobs?limit=0'), expect: invalid([['limit']]) },
  { name: 'one job', before: [files], call: get('/jobs/A'), expect: { status: 200, body: job('A', files) } },
  {
    name: 'a job that is not there',
    call: get('/jobs/Z'),
    expect: { status: 404, body: { error: 'no-job', id: 'Z' } },
  },
]

const Refused = z.looseObject({
  error: z.string(),
  issues: z.array(z.object({ path: z.array(z.coerce.string()) })).optional(),
  reason: z.string().optional(),
})

function shown(status: number, body: unknown): unknown {
  if (status < 400) return body
  const { issues, reason, ...rest } = Refused.parse(body)
  return issues === undefined ? rest : { ...rest, paths: issues.map((i) => i.path) }
}

Testing.each('Api.routes jobs', cases, (it) =>
  Testing.within(async (w) => {
    Testing.config(w, {})
    const bench = Testing.bench()
    for (const work of it.before ?? []) Jobs.submit(bench.queue, work, 'api', 0)
    const res = await Api.routes(w.host, bench.queue).request(it.call.path, {
      method: it.call.method,
      body: it.call.body,
    })
    expect({ status: res.status, body: shown(res.status, await res.json()) }).toEqual({
      status: it.expect.status,
      body: it.expect.body,
    })
    if (it.expect.queued) expect(bench.queue.jobs.map((j) => j.work)).toEqual(it.expect.queued)
  }),
)
