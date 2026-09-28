import { expect } from 'bun:test'
import type { Diff } from '@bicycle/shared'
import type { Claims } from '@bicycle/core/detect/claims'
import { Scans } from '@bicycle/core/detect/scans'
import { Kinds } from '@bicycle/core/kinds'
import { Testing } from '@bicycle/core/testing'

type PlanCase = {
  name: string
  config: unknown
  ignore?: string
  scans?: Scans.Record[]
  only: string[]
  expect: {
    diffs: readonly Partial<Diff>[]
    ignored: number
    scanned?: (string | null | undefined)[]
  }
}

const MISSING = 'definitely-not-a-real-package-9b3c'
const GROUP = 'definitely-not-a-real-group-9b3c'

const stray = (id: string): Diff => ({ type: 'stray', id, field: 'exists', expected: null, actual: true })

const scan = (detector: string, diffs: Diff[]): Scans.Record => ({
  detector,
  startedAt: '2000-01-01T00:00:00.000Z',
  finishedAt: '2000-01-01T00:05:00.000Z',
  diffs,
})

const PLAN_CASES: PlanCase[] = [
  {
    name: 'no ignore.yml leaves diffs untouched',
    config: { packages: { extra: [MISSING] } },
    only: ['packages'],
    expect: { diffs: [{ type: 'package', id: MISSING, field: 'installed' }], ignored: 0, scanned: [undefined] },
  },
  {
    name: 'a diffs rule filters declared drift and counts it',
    config: { packages: { extra: [MISSING] } },
    ignore: `diffs:\n  - { type: package, id: ${MISSING} }\n`,
    only: ['packages'],
    expect: { diffs: [], ignored: 1 },
  },
  {
    name: 'the packages section does not hide declared-but-missing',
    config: { packages: { extra: [MISSING] } },
    ignore: `packages: [${MISSING}]\n`,
    only: ['packages'],
    expect: { diffs: [{ type: 'package', id: MISSING, field: 'installed' }], ignored: 0 },
  },
  {
    name: 'only limits which kinds plan',
    config: { packages: { extra: [MISSING] }, groups: [{ name: GROUP, gid: 64999 }] },
    only: ['groups'],
    expect: { diffs: [{ type: 'group', id: GROUP, field: 'exists' }], ignored: 0 },
  },
  {
    name: 'a persisted scan surfaces and obeys ignore.yml',
    config: {},
    ignore: 'files: [/a]\n',
    scans: [scan('fs', [stray('/a'), stray('/b')])],
    only: ['fs'],
    expect: { diffs: [{ type: 'stray', id: '/b' }], ignored: 1, scanned: ['2000-01-01T00:05:00.000Z'] },
  },
  {
    name: 'a detector that never ran plans empty',
    config: {},
    only: ['fs'],
    expect: { diffs: [], ignored: 0, scanned: [null] },
  },
  {
    name: 'a declared detector is a kind',
    config: { detectors: [{ name: 'brew', exec: ['/usr/bin/true'] }] },
    scans: [scan('brew', [{ type: 'brew', id: 'A', field: 'installed', expected: null, actual: true }])],
    only: ['brew'],
    expect: { diffs: [{ type: 'brew', id: 'A' }], ignored: 0 },
  },
]

Testing.each('Kinds.plan', PLAN_CASES, (it) =>
  Testing.within(async (w) => {
    Testing.config(w, it.config)
    if (it.ignore !== undefined) Testing.put(w, w.host.paths.etc.ignore, it.ignore)
    for (const record of it.scans ?? []) Scans.write(w.host, record)
    const plan = await Kinds.plan(w.host, it.only)
    Testing.expectDiffs(plan.diffs, it.expect.diffs)
    expect(plan.ignored).toBe(it.expect.ignored)
    if (it.expect.scanned) expect(plan.kinds.map((k) => k.scannedAt)).toEqual(it.expect.scanned)
  }),
)

type NamesCase = { name: string; config: unknown; expect: string[] }

const BUILTIN = ['groups', 'users', 'sudoers', 'dirs', 'files', 'packages', 'systemd', 'ingress', 'fs']

const NAMES_CASES: NamesCase[] = [
  { name: 'the builtin kinds and the fs detector', config: {}, expect: BUILTIN },
  {
    name: 'a declared detector is added; one named like a builtin is dropped',
    config: {
      detectors: [
        { name: 'brew', exec: ['/usr/bin/true'] },
        { name: 'packages', exec: ['/usr/bin/true'] },
        { name: 'fs', exec: ['/usr/bin/true'] },
      ],
    },
    expect: [...BUILTIN, 'brew'],
  },
  { name: 'a spec that does not parse declares none', config: 'dirs: [\n', expect: BUILTIN },
]

Testing.each('Kinds.names', NAMES_CASES, (it) =>
  Testing.within((w) => {
    Testing.config(w, it.config)
    expect(Kinds.names(w.host)).toEqual(it.expect)
  }),
)

type ClaimsCase = { name: string; config: unknown; written?: string[]; expect: Claims }

const CLAIMS_CASES: ClaimsCase[] = [
  {
    name: "every kind's claims with bicycle's own trees",
    config: { dirs: [{ path: '/media' }] },
    written: ['etc/motd', 'etc/profile.d/x.sh'],
    expect: {
      exact: ['/etc/hosts', '/etc/motd', '/etc/profile.d/x.sh', '/etc/sudoers.d/bicycle'],
      prefixes: ['/etc/bicycle', '/media', '/var/lib/bicycle'],
    },
  },
  {
    name: 'a spec that does not parse drops dir claims but keeps the rest',
    config: 'dirs: [\n',
    expect: { exact: ['/etc/hosts', '/etc/sudoers.d/bicycle'], prefixes: ['/etc/bicycle', '/var/lib/bicycle'] },
  },
]

Testing.each('Kinds.claims', CLAIMS_CASES, (it) =>
  Testing.within(async (w) => {
    const actions: Testing.Action[] = [
      { do: 'config', config: it.config },
      ...(it.written
        ? [{ do: 'state' as const, rel: 'files-manifest.json', contents: JSON.stringify(it.written) }]
        : []),
    ]
    await Testing.runActions(w, actions, async () => {})
    expect(Kinds.claims(w.host)).toEqual(it.expect)
  }),
)
