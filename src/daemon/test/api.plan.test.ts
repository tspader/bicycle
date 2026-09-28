import { expect } from 'bun:test'
import { Api } from '@bicycle/daemon/api'
import { Testing } from '@bicycle/daemon/testing'

type Case = {
  name: string
  config: unknown
  path: string
  expect: { status: number; body: unknown }
}

const P = 'definitely-not-a-real-package-9b3c'
const missing = { type: 'package', id: P, field: 'installed', expected: true, actual: false }
const config = { packages: { extra: [P] } }
const KNOWN = ['groups', 'users', 'sudoers', 'dirs', 'files', 'packages', 'systemd', 'ingress', 'fs']

const cases: Case[] = [
  {
    name: 'one kind',
    config,
    path: '/plan?only=packages',
    expect: { status: 200, body: { kinds: [{ kind: 'packages', diffs: [missing] }], diffs: [missing], ignored: 0 } },
  },
  {
    name: 'several kinds, in the order they plan',
    config,
    path: '/plan?only=packages&only=dirs',
    expect: {
      status: 200,
      body: {
        kinds: [
          { kind: 'dirs', diffs: [] },
          { kind: 'packages', diffs: [missing] },
        ],
        diffs: [missing],
        ignored: 0,
      },
    },
  },
  {
    name: 'a kind that is not one',
    config,
    path: '/plan?only=packages&only=Z',
    expect: { status: 400, body: { error: 'unknown', names: ['Z'], known: KNOWN } },
  },
]

Testing.each('Api.routes plan', cases, (it) =>
  Testing.within(async (w) => {
    Testing.config(w, it.config)
    const bench = Testing.bench()
    const res = await Api.routes(w.host, bench.queue).request(it.path)
    expect({ status: res.status, body: await res.json() }).toEqual(it.expect)
  }),
)

type KindsCase = { name: string; config: unknown; expect: string[] }

const KINDS_CASES: KindsCase[] = [{ name: 'no kinds asked for is every kind', config: {}, expect: KNOWN }]

Testing.each('Api.routes plan', KINDS_CASES, (it) =>
  Testing.within(async (w) => {
    Testing.config(w, it.config)
    const res = await Api.routes(w.host, Testing.bench().queue).request('/plan')
    const body = (await res.json()) as { kinds: { kind: string }[] }
    expect(body.kinds.map((k) => k.kind)).toEqual(it.expect)
  }),
)
