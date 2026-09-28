import { expect } from 'bun:test'
import type { Log } from '@bicycle/core/log'
import { Jobs } from '@bicycle/daemon/jobs'
import { Testing } from '@bicycle/daemon/testing'

type Step =
  | { do: 'submit'; work: Jobs.Work; trigger: Jobs.Trigger; delay: number }
  | { do: 'tick' }
  | { do: 'wait'; ms: number }
  | { do: 'push'; message: Jobs.Message }
  | { do: 'repeat'; times: number; steps: Step[] }

type Row = Pick<Jobs.Job, 'id' | 'status'> & Partial<Jobs.Job>

type Case = {
  name: string
  steps: Step[]
  expect: { jobs: Row[]; started?: string[]; submitted?: string[]; inbox?: number }
}

const files: Jobs.Work = { kind: 'reconcile', only: ['files'] }
const users: Jobs.Work = { kind: 'reconcile', only: ['users'] }
const app: Jobs.Work = { kind: 'app', name: 'A' }
const scan: Jobs.Work = { kind: 'scan', only: ['fs'], priority: 'idle', timeout: 1 }

const submit = (work: Jobs.Work, delay = 0, trigger: Jobs.Trigger = 'api'): Step => ({
  do: 'submit',
  work,
  trigger,
  delay,
})
const tick: Step = { do: 'tick' }
const wait = (ms: number): Step => ({ do: 'wait', ms })
const ended = (id: string): Step => ({ do: 'push', message: { kind: 'ended', id, outcomes: [] } })
const failed = (id: string): Step => ({ do: 'push', message: { kind: 'failed', id, message: 'M' } })
const line = (level: Log.Level): Log.Line => ({ level, msg: 'M', data: {} })
const logged = (id: string, level: Log.Level): Step => ({
  do: 'push',
  message: { kind: 'line', id, line: line(level) },
})
const progress = (id: string): Step => ({
  do: 'push',
  message: { kind: 'progress', id, progress: { detector: 'fs', done: 1 } },
})
const at = (seconds: number): string => new Date(Testing.epoch + seconds * 1000).toISOString()

const cases: Case[] = [
  {
    name: 'a submitted job is queued until a tick',
    steps: [submit(files)],
    expect: { jobs: [{ id: 'A', status: 'queued', trigger: 'api', created: at(0), started: null }], started: [] },
  },
  {
    name: 'a tick starts a queued job',
    steps: [submit(files), wait(1000), tick],
    expect: { jobs: [{ id: 'A', status: 'running', started: at(1) }], started: ['A'] },
  },
  {
    name: 'what changes the machine runs one at a time, oldest first',
    steps: [submit(files), submit(users), submit(app), tick, tick],
    expect: {
      jobs: [
        { id: 'A', status: 'running' },
        { id: 'B', status: 'queued' },
        { id: 'C', status: 'queued' },
      ],
      started: ['A'],
    },
  },
  {
    name: 'a scan runs beside a reconcile',
    steps: [submit(files), submit(scan), tick],
    expect: {
      jobs: [
        { id: 'A', status: 'running' },
        { id: 'B', status: 'running' },
      ],
      started: ['A', 'B'],
    },
  },
  {
    name: 'the same work asked twice while queued is one job',
    steps: [submit(files), submit(files)],
    expect: { jobs: [{ id: 'A', status: 'queued' }], submitted: ['A', 'A'] },
  },
  {
    name: 'the same work asked while it runs is queued behind it',
    steps: [submit(files), tick, submit(files), tick],
    expect: {
      jobs: [
        { id: 'A', status: 'running' },
        { id: 'B', status: 'queued' },
      ],
      started: ['A'],
    },
  },
  {
    name: 'a delayed job does not start before it is ready',
    steps: [submit(files, 250, 'watch'), wait(249), tick],
    expect: { jobs: [{ id: 'A', status: 'queued', trigger: 'watch', ready: at(0.25) }], started: [] },
  },
  {
    name: 'a delayed job starts once it is ready',
    steps: [submit(files, 250, 'watch'), wait(250), tick],
    expect: { jobs: [{ id: 'A', status: 'running' }], started: ['A'] },
  },
  {
    name: 'asking again pushes a delayed job back',
    steps: [submit(files, 250, 'watch'), wait(200), submit(files, 250, 'watch'), wait(200), tick],
    expect: { jobs: [{ id: 'A', status: 'queued', ready: at(0.45) }], started: [] },
  },
  {
    name: 'asking again with no delay does not pull a delayed job forward',
    steps: [submit(files, 250, 'watch'), submit(files)],
    expect: { jobs: [{ id: 'A', status: 'queued', ready: at(0.25) }] },
  },
  {
    name: 'an ended job is done and the next one starts',
    steps: [submit(files), submit(users), tick, ended('A'), wait(1000), tick],
    expect: {
      jobs: [
        { id: 'A', status: 'done', finished: at(1), failure: null },
        { id: 'B', status: 'running', started: at(1) },
      ],
      started: ['A', 'B'],
    },
  },
  {
    name: 'a job that logged an error has failed',
    steps: [submit(files), tick, logged('A', 'info'), logged('A', 'error'), ended('A'), tick],
    expect: { jobs: [{ id: 'A', status: 'failed', failure: null, lines: [line('info'), line('error')] }] },
  },
  {
    name: 'a job that logged a warning is done',
    steps: [submit(files), tick, logged('A', 'warn'), ended('A'), tick],
    expect: { jobs: [{ id: 'A', status: 'done' }] },
  },
  {
    name: 'a job whose work threw has failed with what it threw',
    steps: [submit(files), tick, failed('A'), tick],
    expect: { jobs: [{ id: 'A', status: 'failed', failure: 'M' }] },
  },
  {
    name: 'progress is kept while the job runs',
    steps: [submit(scan), tick, progress('A'), tick],
    expect: { jobs: [{ id: 'A', status: 'running', progress: { detector: 'fs', done: 1 } }] },
  },
  {
    name: 'progress is cleared when the job ends',
    steps: [submit(scan), tick, progress('A'), ended('A'), tick],
    expect: { jobs: [{ id: 'A', status: 'done', progress: null }] },
  },
  {
    name: 'nothing is applied before the tick',
    steps: [submit(files), tick, ended('A')],
    expect: { jobs: [{ id: 'A', status: 'running' }], inbox: 1 },
  },
  {
    name: 'a message for a job that is not running is dropped',
    steps: [submit(files), ended('A'), logged('Z', 'error'), tick, tick],
    expect: { jobs: [{ id: 'A', status: 'running', lines: [] }], inbox: 0 },
  },
  {
    name: 'reconcilers are put in the order they run in',
    steps: [submit({ kind: 'reconcile', only: ['files', 'groups', 'files'] })],
    expect: { jobs: [{ id: 'A', status: 'queued', work: { kind: 'reconcile', only: ['groups', 'files'] } }] },
  },
  {
    name: 'detectors are sorted and named once',
    steps: [submit({ ...scan, only: ['b', 'a', 'b'] })],
    expect: { jobs: [{ id: 'A', status: 'queued', work: { ...scan, only: ['a', 'b'] } }] },
  },
  {
    name: 'only the newest lines are kept and the rest are counted',
    steps: [
      submit(files),
      tick,
      { do: 'repeat', times: Jobs.LINES + 2, steps: [logged('A', 'info')] },
      logged('A', 'warn'),
      tick,
    ],
    expect: {
      jobs: [
        {
          id: 'A',
          status: 'running',
          skipped: 3,
          lines: [...Array.from({ length: Jobs.LINES - 1 }, () => line('info')), line('warn')],
        },
      ],
    },
  },
]

function run(bench: Testing.Bench, step: Step, submitted: string[]): void {
  switch (step.do) {
    case 'submit':
      submitted.push(Jobs.submit(bench.queue, step.work, step.trigger, step.delay).id)
      return
    case 'tick':
      Jobs.tick(bench.queue, bench.worker)
      return
    case 'wait':
      bench.clock.wait(step.ms)
      return
    case 'push':
      Jobs.push(bench.queue, step.message)
      return
    case 'repeat':
      for (const _ of Array(step.times)) for (const each of step.steps) run(bench, each, submitted)
      return
  }
}

Testing.each('Jobs', cases, (it) => {
  const bench = Testing.bench()
  const submitted: string[] = []
  for (const step of it.steps) run(bench, step, submitted)
  expect(bench.queue.jobs).toMatchObject(it.expect.jobs)
  expect(bench.queue.jobs).toHaveLength(it.expect.jobs.length)
  if (it.expect.started) expect(bench.started.map((s) => s.id)).toEqual(it.expect.started)
  if (it.expect.submitted) expect(submitted).toEqual(it.expect.submitted)
  if (it.expect.inbox !== undefined) expect(bench.queue.inbox).toHaveLength(it.expect.inbox)
})

type KeptCase = { name: string; finished: number; expect: { kept: number; oldest: string } }

const KEPT_CASES: KeptCase[] = [
  { name: 'every finished job is kept up to the limit', finished: Jobs.KEPT, expect: { kept: Jobs.KEPT, oldest: 'A' } },
  {
    name: 'the oldest finished job is forgotten past it',
    finished: Jobs.KEPT + 1,
    expect: { kept: Jobs.KEPT, oldest: 'B' },
  },
]

Testing.each('Jobs.tick', KEPT_CASES, (it) => {
  const bench = Testing.bench()
  for (const _ of Array(it.finished)) {
    const job = Jobs.submit(bench.queue, files, 'api', 0)
    Jobs.tick(bench.queue, bench.worker)
    Jobs.push(bench.queue, { kind: 'ended', id: job.id, outcomes: [] })
    Jobs.tick(bench.queue, bench.worker)
  }
  expect({ kept: bench.queue.jobs.length, oldest: bench.queue.jobs[0]!.id }).toEqual(it.expect)
})
