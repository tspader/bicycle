import { expect } from 'bun:test'
import type { Log } from '@bicycle/core/log'
import type { Reconcilers } from '@bicycle/core/reconcilers'
import type { Jobs } from '@bicycle/daemon/jobs'
import { Testing } from '@bicycle/daemon/testing'
import { Worker, type Fail } from '@bicycle/daemon/worker'

type Case = {
  name: string
  config: unknown
  files?: Record<string, string>
  work: Jobs.Work
  expect: { kinds: Jobs.Message['kind'][]; last: Partial<Jobs.Message>; host: Log.Level[] }
}

const files: Jobs.Work = { kind: 'reconcile', only: ['files'] }

const tree = (it: { config: unknown; files?: Record<string, string> }): Testing.Action[] => [
  { do: 'config', config: it.config },
  ...Object.entries(it.files ?? {}).map(([rel, contents]) => ({ do: 'file' as const, rel, contents })),
]

const cases: Case[] = [
  {
    name: 'work that logs nothing just ends',
    config: {},
    work: files,
    expect: { kinds: ['ended'], last: { kind: 'ended', id: 'A', outcomes: [] }, host: [] },
  },
  {
    name: 'what the work logs reaches the job and the daemon log',
    config: {},
    files: { 'etc/a': 'T' },
    work: files,
    expect: { kinds: ['line', 'ended'], last: { kind: 'ended', id: 'A' }, host: ['info'] },
  },
  {
    name: 'work that throws has failed',
    config: 'dirs: [\n',
    work: { kind: 'app', name: 'A' },
    expect: { kinds: ['failed'], last: { kind: 'failed', id: 'A' }, host: [] },
  },
  {
    name: 'a scan ends with what its detectors found',
    config: {},
    work: { kind: 'scan', only: ['fs'], priority: 'full', timeout: 1000 },
    expect: {
      kinds: ['line', 'ended'],
      last: {
        kind: 'ended',
        id: 'A',
        outcomes: [{ kind: 'failed', detector: 'fs', message: 'bicycle-fs-scan: command not found' }],
      },
      host: ['error'],
    },
  },
]

Testing.each('Worker.real', cases, (it) =>
  Testing.within(async (w) => {
    await Testing.runActions(w, tree(it), async () => {})
    const seen: Jobs.Message[] = []
    const ended = Promise.withResolvers<void>()
    const worker = Worker.real(w.host, (message) => {
      seen.push(message)
      if (message.kind === 'ended' || message.kind === 'failed') ended.resolve()
    })
    worker.start('A', it.work)
    await ended.promise
    expect(seen.map((m) => m.kind)).toEqual(it.expect.kinds)
    expect(seen.at(-1)).toMatchObject(it.expect.last)
    expect(w.lines.map((line) => line.level)).toEqual(it.expect.host)
  }),
)

type OnceCase = {
  name: string
  config: unknown
  files?: Record<string, string>
  only: Reconcilers.Name[]
  expect: { error?: Fail.Kind; host: Log.Level[]; changes: string[] }
}

const group = { groups: [{ name: 'media', gid: 1500 }] }

const ONCE_CASES: OnceCase[] = [
  {
    name: 'a reconcile that logs no error is done',
    config: group,
    only: ['groups'],
    expect: { host: ['info', 'info'], changes: ['groupadd -g 1500 media'] },
  },
  {
    name: 'only the reconcilers asked for run',
    config: group,
    only: ['files'],
    expect: { host: [], changes: [] },
  },
  {
    name: 'a reconcile that logged an error has failed, after everything else ran',
    config: group,
    files: { 'etc/a.age': 'T', 'etc/b': 'T' },
    only: ['groups', 'files'],
    expect: { error: 'failed', host: ['info', 'info', 'error', 'info'], changes: ['groupadd -g 1500 media'] },
  },
]

Testing.each('Worker.once', ONCE_CASES, (it) =>
  Testing.within(async (w) => {
    await Testing.runActions(w, tree(it), async () => {})
    const outcome = await Testing.outcome(() => Worker.once(w.host, it.only))
    expect({
      error: 'error' in outcome ? outcome.error : undefined,
      host: w.lines.map((line) => line.level),
      changes: w.machine.changes,
    }).toEqual({ error: undefined, ...it.expect })
  }),
)
