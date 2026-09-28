import { expect } from 'bun:test'
import { ignore, type Detector, type Diff } from '@bicycle/shared'
import { Detect } from '@bicycle/core/detect'
import { Claims } from '@bicycle/core/detect/claims'
import { Exec } from '@bicycle/core/detect/exec'
import { Scans } from '@bicycle/core/detect/scans'
import { Testing } from '@bicycle/core/testing'

type ExecCase = {
  name: string
  script: Testing.Detector
  env?: Record<string, string>
  timeout?: number
  grace?: number
  expect: {
    diffs?: readonly Partial<Diff>[]
    malformed?: number
    progress?: readonly { done: number }[]
    warns?: string[]
    throws?: RegExp
  }
}

const D: Detector = { name: 'D', exec: ['/D'] }

const found = (id: string): Diff => ({ type: 'stray', id, field: 'exists', expected: null, actual: true })
const emit = (diff: Diff): string => JSON.stringify({ t: 'diff', ...diff })
const said = (...lines: string[]): string => lines.map((line) => `${line}\n`).join('')
const says =
  (...lines: string[]): Testing.Detector =>
  () => ({ out: said(...lines) })

const X = emit(found('/etc/x'))

const EXEC_CASES: ExecCase[] = [
  {
    name: 'diff lines parse, meta and redacted ride along',
    script: says(
      X,
      '{"t":"diff","type":"pacman-file","id":"/etc/sddm.conf","field":"content","expected":"aa","actual":"bb","meta":{"pkg":"sddm"},"redacted":true}',
    ),
    expect: {
      diffs: [
        { type: 'stray', id: '/etc/x', field: 'exists', expected: null, actual: true },
        {
          type: 'pacman-file',
          id: '/etc/sddm.conf',
          field: 'content',
          meta: { pkg: 'sddm' },
          redacted: true,
        },
      ],
      malformed: 0,
    },
  },
  {
    name: 'progress lines reach the callback in order',
    script: says('{"t":"progress","done":1,"total":10}', '{"t":"progress","done":2,"msg":"/usr/lib/x"}', X),
    expect: { diffs: [{ id: '/etc/x' }], progress: [{ done: 1 }, { done: 2 }] },
  },
  {
    name: 'log lines and unknown tags are not findings',
    script: says('{"t":"log","level":"warn","msg":"skipping /weird"}', '{"t":"telemetry","whatever":1}', X),
    expect: { diffs: [{ id: '/etc/x' }], malformed: 0, warns: ['skipping /weird'] },
  },
  {
    name: 'malformed lines are counted, not fatal',
    script: says('not json at all', '{"t":"diff","type":"stray"}', X),
    expect: { diffs: [{ id: '/etc/x' }], malformed: 2, warns: ['detector emitted malformed lines'] },
  },
  {
    name: 'a final unterminated line still parses',
    script: () => ({ out: X }),
    expect: { diffs: [{ id: '/etc/x' }] },
  },
  {
    name: 'stderr is debug, not findings',
    script: () => ({ out: said(X), err: said('free-form debug') }),
    expect: { diffs: [{ id: '/etc/x' }] },
  },
  {
    name: 'nonzero exit discards results and surfaces stderr',
    script: () => ({ out: said(X), err: said('disk exploded'), code: 3 }),
    expect: { throws: /exited 3.*disk exploded/s },
  },
  {
    name: 'timeout kills the detector and fails the run',
    script: () => ({ hangs: true }),
    timeout: 250,
    grace: 250,
    expect: { throws: /timed out after 250ms/ },
  },
  {
    name: 'a detector that ignores the first signal is killed after the grace',
    script: () => ({ hangs: true, stubborn: true, err: said('E') }),
    timeout: 250,
    grace: 250,
    expect: { throws: /timed out after 250ms: E/ },
  },
  {
    name: 'a detector that is done in time is not killed',
    script: () => ({ out: said(X), takes: 249 }),
    timeout: 250,
    grace: 250,
    expect: { diffs: [{ id: '/etc/x' }] },
  },
  {
    name: 'a detector that leaves stdout open is cut off after the grace',
    script: () => ({ out: said(X), open: true }),
    expect: { diffs: [{ id: '/etc/x' }], warns: ['detector left stdout open; output truncated'] },
  },
  {
    name: 'contract env vars reach the detector',
    script: ({ env }) => ({
      out: said(
        emit({ type: 'env', id: env.BICYCLE_PRUNES!, field: 'claims', expected: null, actual: env.BICYCLE_CLAIMS! }),
      ),
    }),
    env: { BICYCLE_PRUNES: '/run/x/prunes.txt', BICYCLE_CLAIMS: '/run/x/claims.txt' },
    expect: {
      diffs: [{ type: 'env', id: '/run/x/prunes.txt', actual: '/run/x/claims.txt' }],
    },
  },
]

Testing.each('Exec.run', EXEC_CASES, (c) =>
  Testing.within(async (w) => {
    w.machine.detectors[D.exec[0]!] = c.script
    const progress: { done: number }[] = []
    const run = Testing.drive(
      w.time,
      Exec.run(w.host, D, {
        env: c.env ?? {},
        timeout: c.timeout ?? Exec.TIMEOUT,
        grace: c.grace ?? Exec.GRACE,
        progress: (p) => progress.push({ done: p.done }),
      }),
    )
    if (c.expect.throws) {
      await expect(run).rejects.toThrow(c.expect.throws)
      return
    }
    const result = await run
    if (c.expect.diffs) Testing.expectDiffs(result.diffs, c.expect.diffs)
    if (c.expect.malformed !== undefined) expect(result.malformed).toBe(c.expect.malformed)
    if (c.expect.progress) expect(progress).toEqual([...c.expect.progress])
    expect(Testing.levels(w, 'warn')).toEqual(c.expect.warns ?? [])
  }),
)

type PrunesCase = { name: string; files: string[]; expect: string }

const PRUNES_CASES: PrunesCase[] = [
  {
    name: 'plain paths render one per line; globs stay plan-side',
    files: ['/var', '**/*.pacnew', '/usr/share/icons/*/icon-theme.cache', '/etc/machine-id'],
    expect: '/etc/machine-id\n/var\n',
  },
  { name: 'no files render nothing', files: [], expect: '' },
]

Testing.each('Detect.prunes', PRUNES_CASES, (c) => {
  expect(Detect.prunes(ignore.IgnoreConfig.parse({ files: c.files }))).toBe(c.expect)
})

type ClaimsCase = { name: string; claims: Claims; expect: string }

const CLAIMS_CASES: ClaimsCase[] = [
  { name: 'prefixes, then exacts', claims: { exact: ['/a'], prefixes: ['/b'] }, expect: 'P /b\nE /a\n' },
]

Testing.each('Claims.render', CLAIMS_CASES, (c) => {
  expect(Claims.render(c.claims)).toBe(c.expect)
})

type ScansCase = { name: string; write?: Scans.Record; text?: string; read: string; expect: Scans.Record | null }

const record: Scans.Record = {
  detector: 'D',
  startedAt: '2000-01-01T00:00:00.000Z',
  finishedAt: '2000-01-01T00:05:00.000Z',
  diffs: [found('/a')],
}

const SCANS_CASES: ScansCase[] = [
  { name: 'a written record reads back', write: record, read: 'D', expect: record },
  { name: 'a detector that never ran has none', read: 'D', expect: null },
  { name: 'a record that is not JSON reads as none', text: 'Z', read: 'D', expect: null },
  {
    name: "another detector's record reads as none",
    text: JSON.stringify({ ...record, detector: 'E' }),
    read: 'D',
    expect: null,
  },
]

Testing.each('Scans', SCANS_CASES, (c) =>
  Testing.within((w) => {
    const file = w.host.paths.state.scan(c.read)
    if (c.write) Scans.write(w.host, c.write)
    if (c.text !== undefined) Testing.put(w, file, c.text)
    expect(Scans.read(w.host, c.read)).toEqual(c.expect)
    expect(Testing.node(w, `${file}.tmp`)).toBeUndefined()
  }),
)

type ScanCase = {
  name: string
  before?: Scans.Record
  detector?: Detector
  script: Testing.Detector
  priority: Detect.Priority
  expect: { outcomes: Detect.Outcome[]; record: Scans.Record | null }
}

const SECOND = 1000

const finds =
  (ids: (seen: Testing.Seen) => string[]): Testing.Detector =>
  (seen) => ({ out: said(...ids(seen).map((id) => emit(found(id)))), takes: SECOND })

const stamped = (diffs: Diff[]): Scans.Record => ({
  detector: 'D',
  startedAt: '2000-01-01T00:00:00.000Z',
  finishedAt: '2000-01-01T00:00:01.000Z',
  diffs,
})

const SCAN_CASES: ScanCase[] = [
  {
    name: 'findings are recorded between two readings of the clock',
    script: finds(() => ['/a']),
    priority: 'full',
    expect: { outcomes: [{ kind: 'scanned', detector: 'D', findings: 1 }], record: stamped([found('/a')]) },
  },
  {
    name: 'a detector that fails keeps the previous record',
    before: record,
    script: () => ({ err: said('E'), code: 3 }),
    priority: 'full',
    expect: {
      outcomes: [{ kind: 'failed', detector: 'D', message: 'detector D exited 3: E' }],
      record,
    },
  },
  {
    name: 'a detector that is not there keeps the previous record',
    before: record,
    detector: { name: 'D', exec: ['/E'] },
    script: () => ({}),
    priority: 'full',
    expect: {
      outcomes: [{ kind: 'failed', detector: 'D', message: '/E: command not found' }],
      record,
    },
  },
  {
    name: 'an idle scan tells the detector to stay in the background',
    script: finds(({ env }) => [env.BICYCLE_BACKGROUND ?? '']),
    priority: 'idle',
    expect: { outcomes: [{ kind: 'scanned', detector: 'D', findings: 1 }], record: stamped([found('1')]) },
  },
  {
    name: 'a full scan does not',
    script: finds(({ env }) => [env.BICYCLE_BACKGROUND ?? 'unset']),
    priority: 'full',
    expect: { outcomes: [{ kind: 'scanned', detector: 'D', findings: 1 }], record: stamped([found('unset')]) },
  },
  {
    name: 'the detector is handed the prunes and the claims',
    script: finds(({ env, read }) =>
      (read(env.BICYCLE_PRUNES!) + read(env.BICYCLE_CLAIMS!)).split('\n').filter((line) => line !== ''),
    ),
    priority: 'full',
    expect: {
      outcomes: [{ kind: 'scanned', detector: 'D', findings: 3 }],
      record: stamped([found('/p'), found('P /b'), found('E /a')]),
    },
  },
]

Testing.each('Detect.scan', SCAN_CASES, (c) =>
  Testing.within(async (w) => {
    w.machine.detectors[D.exec[0]!] = c.script
    if (c.before) Scans.write(w.host, c.before)
    const outcomes = await Testing.drive(
      w.time,
      Detect.scan(w.host, {
        detectors: [c.detector ?? D],
        ignores: ignore.IgnoreConfig.parse({ files: ['/p'] }),
        claims: { exact: ['/a'], prefixes: ['/b'] },
        priority: c.priority,
        timeout: Exec.TIMEOUT,
        progress: () => {},
      }),
    )
    expect({ outcomes, record: Scans.read(w.host, 'D') }).toEqual(c.expect)
  }),
)
