import { expect } from 'bun:test'
import { build } from '@spader/zargs'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { Client } from '@bicycle/daemon/client'
import type { Jobs } from '@bicycle/daemon/jobs'
import { Cli } from '@bicycle/cli/cli'
import { Testing } from '@bicycle/cli/testing'

type Seen = Testing.Seen & { hits: Testing.Hit[] }

type Case = {
  name: string
  argv: string[]
  input?: string
  failure?: string
  replies?: Testing.Reply[] | 'down'
  expect: Seen
}

const seen = (rest: Partial<Seen>): Seen => ({ hits: [], out: [], err: [], code: 0, ran: [], ...rest })
const ok = (body: unknown): Testing.Reply => ({ status: 200, body })
const none: Testing.Reply = { status: 204, body: null }
const get = (path: string): Testing.Hit => ({ method: 'GET', path, body: '' })
const post = (body: unknown): Testing.Hit => ({ method: 'POST', path: '/api/jobs', body: JSON.stringify(body) })

const drift = { type: 'file', id: 'a', field: 'mode', expected: '0644', actual: '0600' }
const plan = (diffs: unknown[], ignored = 0) => ({ kinds: [{ kind: 'files', diffs }], diffs, ignored })
const at = new Date(Testing.epoch).toISOString()
const line = (level: 'info' | 'error', msg: string) => ({ level, msg, data: { a: 'b' } })
const job = (rest: Partial<Jobs.Job>) => Testing.job('A', rest)
const scan: Jobs.Work = { kind: 'scan', only: ['fs'], priority: 'idle', timeout: 1 }

const cases: Case[] = [
  {
    name: 'diff with nothing to show',
    argv: ['diff'],
    replies: [ok(plan([], 2))],
    expect: seen({ hits: [get('/api/plan')], out: ['clean (2 ignored)'] }),
  },
  {
    name: 'diff says how long ago a detector scanned',
    argv: ['diff', '--only', 'fs'],
    replies: [ok({ kinds: [{ kind: 'fs', diffs: [], scannedAt: at }], diffs: [], ignored: 0 })],
    expect: seen({ hits: [get('/api/plan?only=fs')], out: ['# fs: scanned 0m ago\nclean'] }),
  },
  { name: 'no daemon', argv: ['diff'], replies: 'down', expect: seen({ err: ['unreachable'], code: 1 }) },
  {
    name: 'diff with something to show exits 1',
    argv: ['diff', '--only', 'files', 'dirs'],
    replies: [ok(plan([drift]))],
    expect: seen({
      hits: [get('/api/plan?only=files&only=dirs')],
      out: ['~ file a mode: 0600 -> 0644\n1 diff(s)'],
      code: 1,
    }),
  },
  {
    name: 'diff as json',
    argv: ['diff', '--json'],
    replies: [ok(plan([drift]))],
    expect: seen({ hits: [get('/api/plan')], out: [JSON.stringify(drift)], code: 1 }),
  },
  {
    name: 'diff refused',
    argv: ['diff', '--only', 'Z'],
    replies: [{ status: 400, body: { error: 'unknown' } }],
    expect: seen({ hits: [get('/api/plan?only=Z')], err: ['http'], code: 1 }),
  },
  {
    name: 'reconcile follows the job and prints what it logged once',
    argv: ['reconcile'],
    replies: [
      { status: 202, body: job({}) },
      ok(job({ status: 'running', lines: [line('info', 'M')] })),
      ok(job({ status: 'done', lines: [line('info', 'M'), line('info', 'N')] })),
    ],
    expect: seen({
      hits: [post({ kind: 'reconcile' }), get('/api/jobs/A'), get('/api/jobs/A')],
      out: ['info   M  a=b', 'info   N  a=b', `A  done  api  reconcile files  ${at}`],
    }),
  },
  {
    name: 'reconcile of some',
    argv: ['reconcile', '--only', 'files', 'users'],
    replies: [{ status: 202, body: job({}) }, ok(job({ status: 'done' }))],
    expect: seen({
      hits: [post({ kind: 'reconcile', only: ['files', 'users'] }), get('/api/jobs/A')],
      out: [`A  done  api  reconcile files  ${at}`],
    }),
  },
  {
    name: 'reconcile that failed exits 1',
    argv: ['reconcile'],
    replies: [{ status: 202, body: job({}) }, ok(job({ status: 'failed', failure: 'F', lines: [line('error', 'M')] }))],
    expect: seen({
      hits: [post({ kind: 'reconcile' }), get('/api/jobs/A')],
      out: ['error  M  a=b', `A  failed  api  reconcile files  ${at}`],
      err: ['F'],
      code: 1,
    }),
  },
  {
    name: 'reconcile lines that were skipped are not printed twice',
    argv: ['reconcile'],
    replies: [
      { status: 202, body: job({}) },
      ok(job({ status: 'running', lines: [line('info', 'M'), line('info', 'N')] })),
      ok(job({ status: 'done', skipped: 1, lines: [line('info', 'N'), line('info', 'O')] })),
    ],
    expect: seen({
      hits: [post({ kind: 'reconcile' }), get('/api/jobs/A'), get('/api/jobs/A')],
      out: ['info   M  a=b', 'info   N  a=b', 'info   O  a=b', `A  done  api  reconcile files  ${at}`],
    }),
  },
  {
    name: 'reconcile of what is not a reconciler',
    argv: ['reconcile', '--only', 'Z'],
    expect: seen({ err: ['invalid'], code: 1 }),
  },
  {
    name: 'scan',
    argv: ['scan', '--only', 'fs', '--timeout-mins', '2', '--foreground'],
    replies: [
      { status: 202, body: job({ work: scan }) },
      ok(job({ work: scan, status: 'done', outcomes: [{ kind: 'scanned', detector: 'fs', findings: 3 }] })),
    ],
    expect: seen({
      hits: [post({ kind: 'scan', only: ['fs'], priority: 'full', timeout: 120000 }), get('/api/jobs/A')],
      out: ['fs: 3 finding(s)', `A  done  api  scan fs  ${at}`],
    }),
  },
  {
    name: 'scan of every detector at idle priority',
    argv: ['scan'],
    replies: [{ status: 202, body: job({ work: scan }) }, ok(job({ work: scan, status: 'done' }))],
    expect: seen({
      hits: [post({ kind: 'scan', priority: 'idle', timeout: 3600000 }), get('/api/jobs/A')],
      out: [`A  done  api  scan fs  ${at}`],
    }),
  },
  {
    name: 'scan with a detector that failed exits 1',
    argv: ['scan'],
    replies: [
      { status: 202, body: job({ work: scan }) },
      ok(
        job({
          work: scan,
          status: 'failed',
          outcomes: [{ kind: 'failed', detector: 'fs', message: 'M' }],
        }),
      ),
    ],
    expect: seen({
      hits: [post({ kind: 'scan', priority: 'idle', timeout: 3600000 }), get('/api/jobs/A')],
      out: ['fs: failed (M)', `A  failed  api  scan fs  ${at}`],
      code: 1,
    }),
  },
  {
    name: 'jobs',
    argv: ['jobs', '-n', '2'],
    replies: [ok([job({}), Testing.job('B', { status: 'done', trigger: 'watch' })])],
    expect: seen({
      hits: [get('/api/jobs?limit=2')],
      out: [`A  queued  api  reconcile files  ${at}\nB  done  watch  reconcile files  ${at}`],
    }),
  },
  {
    name: 'one job',
    argv: ['jobs', 'A'],
    replies: [ok(job({ status: 'failed', failure: 'F', lines: [line('error', 'M')] }))],
    expect: seen({
      hits: [get('/api/jobs/A')],
      out: [`A  failed  api  reconcile files  ${at}\nF\nerror  M  a=b`],
    }),
  },
  {
    name: 'secret set seals stdin less its newline',
    argv: ['secret', 'set', 'a/b'],
    input: 'T\n',
    replies: [none],
    expect: seen({ hits: [{ method: 'PUT', path: '/api/secrets/a/b', body: 'T' }] }),
  },
  {
    name: 'secret set keeps the newlines inside',
    argv: ['secret', 'set', 'a'],
    input: 'T\nU\n\n',
    replies: [none],
    expect: seen({ hits: [{ method: 'PUT', path: '/api/secrets/a', body: 'T\nU\n' }] }),
  },
  {
    name: 'secret get',
    argv: ['secret', 'get', 'a/b'],
    replies: [ok({ value: 'T' })],
    expect: seen({ hits: [get('/api/secrets/a/b')], out: ['T'] }),
  },
  {
    name: 'secret get of what is not there',
    argv: ['secret', 'get', 'a'],
    replies: [{ status: 404, body: { error: 'no-secret', addr: 'a' } }],
    expect: seen({ hits: [get('/api/secrets/a')], err: ['http'], code: 1 }),
  },
  {
    name: 'secret ls',
    argv: ['secret', 'ls'],
    replies: [ok(['a/b', 'c'])],
    expect: seen({ hits: [get('/api/secrets')], out: ['a/b\nc'] }),
  },
  {
    name: 'secret rm',
    argv: ['secret', 'rm', 'a/b'],
    replies: [none],
    expect: seen({ hits: [{ method: 'DELETE', path: '/api/secrets/a/b', body: '' }] }),
  },
  { name: 'daemon run', argv: ['daemon', 'run'], expect: seen({ ran: [{ kind: 'run' }] }) },
  {
    name: 'daemon once runs everything',
    argv: ['daemon', 'once'],
    expect: seen({ ran: [{ kind: 'once', only: [...Reconcilers.ORDER] }] }),
  },
  {
    name: 'daemon once runs some',
    argv: ['daemon', 'once', '--only', 'groups', 'users'],
    expect: seen({ ran: [{ kind: 'once', only: ['groups', 'users'] }] }),
  },
  {
    name: 'daemon once that failed exits 1',
    argv: ['daemon', 'once', '--only', 'users'],
    failure: 'F',
    expect: seen({ ran: [{ kind: 'once', only: ['users'] }], err: ['Error: F'], code: 1 }),
  },
  {
    name: 'daemon once of what is not a reconciler',
    argv: ['daemon', 'once', '--only', 'Z'],
    expect: seen({ err: ['invalid'], code: 1 }),
  },
]

Testing.each('bicycle', cases, async (it) => {
  const wire = Testing.net(it.replies ?? [{ status: 404, body: null }])
  const fake = Testing.fake(it.input ?? '', it.failure ?? null)
  const time = Testing.time()
  const cli = Cli.cli({ client: Client(wire.url, wire.net), daemon: fake.daemon, clock: time.clock, sys: fake.sys })
  await Testing.drive(time, build(cli).parseAsync(it.argv))
  expect({ ...fake.seen, hits: wire.hits }).toEqual(it.expect)
})
