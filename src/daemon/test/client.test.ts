import { expect } from 'bun:test'
import { Client, Fail } from '@bicycle/daemon/client'
import { Testing } from '@bicycle/daemon/testing'

type Case = {
  name: string
  call: (client: Client) => Promise<unknown>
  reply: Testing.Reply
  expect: { hits: Testing.Hit[]; value: unknown } | { hits: Testing.Hit[]; error: Fail.Kind }
}

const job = Testing.job('A')
const plan = { kinds: [{ kind: 'K', diffs: [], scannedAt: null }], diffs: [], ignored: 1 }
const ok = (body: unknown): Testing.Reply => ({ status: 200, body })
const hit = (method: string, path: string, body = ''): Testing.Hit => ({ method, path, body })

const cases: Case[] = [
  {
    name: 'a plan of everything',
    call: (c) => c.plan([]),
    reply: ok(plan),
    expect: { hits: [hit('GET', '/api/plan')], value: plan },
  },
  {
    name: 'a plan of some kinds',
    call: (c) => c.plan(['a', 'b']),
    reply: ok(plan),
    expect: { hits: [hit('GET', '/api/plan?only=a&only=b')], value: plan },
  },
  {
    name: 'work is submitted',
    call: (c) => c.submit({ kind: 'reconcile', only: ['files'] }),
    reply: { status: 202, body: job },
    expect: { hits: [hit('POST', '/api/jobs', '{"kind":"reconcile","only":["files"]}')], value: job },
  },
  {
    name: 'one job',
    call: (c) => c.job('A'),
    reply: ok(job),
    expect: { hits: [hit('GET', '/api/jobs/A')], value: job },
  },
  {
    name: 'the jobs',
    call: (c) => c.jobs(3),
    reply: ok([job]),
    expect: { hits: [hit('GET', '/api/jobs?limit=3')], value: [job] },
  },
  {
    name: 'the secrets',
    call: (c) => c.secrets(),
    reply: ok(['a/b']),
    expect: { hits: [hit('GET', '/api/secrets')], value: ['a/b'] },
  },
  {
    name: 'a secret',
    call: (c) => c.secret('a/b c'),
    reply: ok({ value: 'T' }),
    expect: { hits: [hit('GET', '/api/secrets/a/b%20c')], value: 'T' },
  },
  {
    name: 'a secret is sealed',
    call: (c) => c.seal('a/b', new TextEncoder().encode('T')),
    reply: { status: 204, body: null },
    expect: { hits: [hit('PUT', '/api/secrets/a/b', 'T')], value: undefined },
  },
  {
    name: 'a secret is forgotten',
    call: (c) => c.forget('a/b'),
    reply: { status: 204, body: null },
    expect: { hits: [hit('DELETE', '/api/secrets/a/b')], value: undefined },
  },
  {
    name: 'a refusal',
    call: (c) => c.job('Z'),
    reply: { status: 404, body: { error: 'no-job', id: 'Z' } },
    expect: { hits: [hit('GET', '/api/jobs/Z')], error: 'http' },
  },
]

Testing.each('Client', cases, async (it) => {
  const wire = Testing.net([it.reply])
  const outcome = await Testing.outcome(() => it.call(Client(wire.url, wire.net)))
  expect({ hits: wire.hits, ...outcome }).toEqual(it.expect)
})

type DownCase = { name: string; expect: { error: Fail.Kind } }

const DOWN_CASES: DownCase[] = [{ name: 'no daemon', expect: { error: 'unreachable' } }]

Testing.each('Client', DOWN_CASES, async (it) => {
  const wire = Testing.net('down')
  expect(await Testing.outcome(() => Client(wire.url, wire.net).secrets())).toEqual(it.expect)
})
