/** @jsxImportSource hono/jsx */
import { z } from 'zod'
import type { Child } from 'hono/jsx'
import type { Diff } from '@bicycle/shared'
import type { Kinds } from '@bicycle/core/kinds'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { signals, route, on, expr, seq, when, bind, text, get, type Code } from '@bicycle/datastar'
import { State } from '@bicycle/daemon/web/state'

export type { Diff }

export const ui = signals({
  q: z.string().default(''),
  shift: z.coerce.boolean().default(false),
  diff: z.string().default(''),
  scan: z.string().default(''),
})

export const pageUrl = (kind: string | null): string => (kind === null ? '/diff' : `/diff/${kind}`)

export const navigate = (kind: string | null): Code<void> =>
  seq(expr`history.pushState({}, '', ${pageUrl(kind)})`, get(pageUrl(kind)))

export const routes = {
  diff: route('get', '/diff'),
  filter: route('post', '/filter'),
  dir: route('post', '/dir', { dir: z.enum(['drift', 'missing', 'undeclared']) }),
  select: route('post', '/select', { id: z.string().min(1) }),
  selectGroup: route('post', '/select-group', { kind: z.string().min(1) }),
  clearSelection: route('post', '/clear-selection'),
  bulkIgnore: route('post', '/bulk-ignore'),
  resolve: route('post', '/resolve', { kind: z.string().min(1) }),
  apply: route('post', '/apply', { kind: z.string().min(1) }),
  scan: route('post', '/scan'),
}

export type Row = {
  id: string
  kind: string
  diff: Diff
  dir: State.Direction
  selected: boolean
}

export type GroupVM = {
  kind: string
  rows: Row[]
  total: number
  applicable: number
  scannedAt?: string | null
}

export type VM = {
  groups: GroupVM[]
  total: number
  visible: number
  ignored: number
  selectedCount: number
  hidden: number
  page: string | null
  filtered: boolean
  dirs: State.Direction[]
  now: Date
}

const DIR_ORDER: Record<State.Direction, number> = { drift: 0, missing: 1, undeclared: 2 }

const matches = (session: State.Session, d: Diff, dir: State.Direction): boolean => {
  if (!session.dirs.has(dir)) return false
  const q = session.q.trim().toLowerCase()
  return q === '' || d.id.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)
}

const applicable = (kind: string, diffs: Diff[]): number =>
  Reconcilers.Name.safeParse(kind).success ? diffs.filter((d) => d.expected !== null).length : 0

export const buildVM = (plan: Kinds.Plan, session: State.Session, now: Date): VM => {
  const groups: GroupVM[] = []
  const order: string[] = []
  const known = new Map<string, State.Ref>()

  for (const kp of plan.kinds) {
    const sorted = [...kp.diffs].sort((a, b) => {
      const da = DIR_ORDER[State.direction(a)] - DIR_ORDER[State.direction(b)]
      return da !== 0 ? da : a.id.localeCompare(b.id)
    })
    const rows: Row[] = []
    for (const d of sorted) {
      const id = State.key(d)
      known.set(id, { kind: kp.kind, diff: d })
      if (!matches(session, d, State.direction(d))) continue
      order.push(id)
      rows.push({ id, kind: kp.kind, diff: d, dir: State.direction(d), selected: false })
    }
    groups.push({
      kind: kp.kind,
      rows,
      total: kp.diffs.length,
      applicable: applicable(kp.kind, kp.diffs),
      scannedAt: kp.scannedAt,
    })
  }

  State.show(session, order, known)
  for (const g of groups) for (const r of g.rows) r.selected = session.selection.has(r.id)

  return {
    groups,
    total: plan.diffs.length,
    visible: order.length,
    ignored: plan.ignored,
    selectedCount: session.selection.size,
    hidden: State.hidden(session),
    page: session.page,
    filtered: session.q.trim() !== '' || session.dirs.size !== State.DIRECTIONS.length,
    dirs: State.DIRECTIONS.filter((dir) => session.dirs.has(dir)),
    now,
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/

const fmtValue = (v: Diff['expected']): string => {
  if (v === null) return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'string' && SHA256_HEX.test(v)) return v.slice(0, 10)
  return String(v)
}

const ago = (iso: string, now: Date): string => {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

const BADGE: Record<State.Direction, string> = {
  drift: 'drift',
  missing: 'missing',
  undeclared: 'undeclared',
}

const Ident = ({ id }: { id: string }) => {
  const slash = id.lastIndexOf('/')
  if (slash <= 0) return <span class="ident">{id}</span>
  return (
    <span class="ident">
      <span class="ident-dir">{id.slice(0, slash + 1)}</span>
      {id.slice(slash + 1)}
    </span>
  )
}

const rowClick = (action: Code): Code => when(expr`!evt.target.closest('button, input, a')`, action)

type Col = { label: string; width: string; cell: (r: Row) => Child }

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

const metaCol = (key: string, width: string, fmt?: (v: unknown) => string): Col => ({
  label: key,
  width,
  cell: (r) => {
    const v = r.diff.meta?.[key]
    if (v === undefined) return <span class="metacell metacell-dim">—</span>
    return <span class="metacell">{fmt ? fmt(v) : String(v)}</span>
  },
})

const EXTRA_COLS: Record<string, Col[]> = {
  fs: [
    metaCol('size', '72px', (v) => (typeof v === 'number' ? fmtBytes(v) : String(v))),
    metaCol('uid', '56px'),
    metaCol('gid', '56px'),
    metaCol('pkg', 'minmax(96px, 160px)'),
  ],
  users: [metaCol('uid', '56px')],
  groups: [metaCol('gid', '56px')],
  systemd: [metaCol('preset', '88px')],
  packages: [
    {
      label: 'origin',
      width: '56px',
      cell: (r) =>
        r.diff.meta?.foreign === true ? (
          <span class="metacell">aur</span>
        ) : (
          <span class="metacell metacell-dim">—</span>
        ),
    },
  ],
}

const gridCols = (kind: string): string =>
  [
    '36px',
    '96px',
    'minmax(240px, max-content)',
    '80px',
    'minmax(80px, max-content)',
    'minmax(80px, max-content)',
    ...(EXTRA_COLS[kind] ?? []).map((c) => c.width),
    '1fr',
    '96px',
  ].join(' ')

const PATH_KINDS = new Set(['fs', 'files', 'dirs', 'sudoers'])

const ColLabels = ({ kind }: { kind: string }) => (
  <div class="collabels rowgrid">
    <span />
    <span>status</span>
    <span>{PATH_KINDS.has(kind) ? 'path' : 'name'}</span>
    <span>field</span>
    <span>desired</span>
    <span>actual</span>
    {(EXTRA_COLS[kind] ?? []).map((c) => (
      <span>{c.label}</span>
    ))}
    <span />
    <span />
  </div>
)

const fullValue = (v: Diff['expected']): string | undefined => {
  if (v === null || typeof v === 'boolean') return undefined
  return Array.isArray(v) ? v.join(', ') : String(v)
}

const Value = ({ v }: { v: Diff['expected'] }) =>
  v === null ? (
    <span class="val val-dim">—</span>
  ) : (
    <span class="val" title={fullValue(v)}>
      {fmtValue(v)}
    </span>
  )

const DefaultRow = ({ r }: { r: Row }) => {
  const d = r.diff
  return (
    <div class={`roww${r.selected ? ' is-selected' : ''}`} id={r.id}>
      <div
        class="row rowgrid"
        {...on('click', rowClick(seq(ui.$.shift.set(expr`evt.shiftKey`), routes.select.action({ id: r.id }))))}
      >
        <span class="cell-check">
          <input type="checkbox" checked={r.selected} tabindex={-1} aria-label="select row" />
        </span>
        <span class={`badge badge-${r.dir}`}>{BADGE[r.dir]}</span>
        <Ident id={d.id} />
        <span class="field">{d.field}</span>
        <span class="values">
          <Value v={d.expected} />
        </span>
        <span class="values">
          <Value v={d.actual} />
          {d.redacted ? <span class="redacted"> redacted</span> : null}
        </span>
        {(EXTRA_COLS[r.kind] ?? []).map((col) => col.cell(r))}
        <span />
        <span class="rowactions">
          <button
            type="button"
            class="btn-ghost"
            {...on('click', seq(ui.$.diff.set(JSON.stringify(d)), routes.resolve.action({ kind: r.kind })))}
          >
            Ignore
          </button>
        </span>
      </div>
    </div>
  )
}

const pageGroups = (vm: VM): GroupVM[] => (vm.page === null ? vm.groups : vm.groups.filter((g) => g.kind === vm.page))

const applyConfirm = (g: GroupVM): string => {
  const acted = g.rows.filter((r) => r.dir !== 'undeclared').map((r) => `• ${r.diff.id} (${r.diff.field})`)
  const shown = acted.slice(0, 6)
  const more = g.applicable - shown.length
  return [
    `Apply ${g.kind}: run its reconciler against this machine.`,
    '',
    ...shown,
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join('\n')
}

const GroupCard = ({ g, vm }: { g: GroupVM; vm: VM }) => {
  const allSelected = g.rows.length > 0 && g.rows.every((r) => r.selected)
  const titled = vm.page === null
  return (
    <section class="group" id={`kind-${g.kind}`} style={`--cols: ${gridCols(g.kind)}`}>
      <header class="group-head">
        <span class="cell-check">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label={`select all ${g.kind}`}
            {...on('click', routes.selectGroup.action({ kind: g.kind }))}
          />
        </span>
        {titled ? <h2 class="group-name">{g.kind}</h2> : null}
        <span class="group-count">
          {vm.filtered && g.rows.length !== g.total ? `${g.rows.length} of ${g.total}` : `${g.total}`}
          {titled && g.scannedAt !== undefined ? (
            <span class="group-stale">
              {' · '}
              {g.scannedAt === null ? 'never scanned' : `scanned ${ago(g.scannedAt, vm.now)}`}
            </span>
          ) : null}
        </span>
        <span class="group-actions">
          {g.applicable > 0 ? (
            <button
              type="button"
              class="btn-accent"
              title={`runs the whole ${g.kind} reconciler on the machine`}
              {...on('click', when(expr`confirm(${applyConfirm(g)})`, routes.apply.action({ kind: g.kind })))}
            >
              Apply {g.applicable === 1 ? '1 change' : `${g.applicable} changes`}
            </button>
          ) : null}
        </span>
      </header>
      {g.rows.length === 0 ? (
        <p class="group-empty">
          {g.scannedAt === null ? 'no data — run a scan' : g.total === 0 ? 'clean' : 'nothing matches the filter'}
        </p>
      ) : (
        <div class="rows">
          <ColLabels kind={g.kind} />
          {g.rows.map((r) => (
            <DefaultRow r={r} />
          ))}
        </div>
      )}
    </section>
  )
}

const CleanState = ({ vm }: { vm: VM }) => (
  <div class="clean">
    <div class="clean-check">✓</div>
    <h2>In sync</h2>
    <p class="clean-sub">{vm.ignored > 0 ? `${vm.ignored} ignored · ` : ''}nothing to review</p>
  </div>
)

export const Rail = ({ vm }: { vm: VM }) => (
  <aside class="rail" id="rail">
    <div class="brand">&gt;&gt; bicycle</div>
    <nav class="rail-nav">
      <a class="rail-link" href="/">
        <span>hosts</span>
      </a>
      <a
        class={`rail-link${vm.page === null ? ' rail-link-active' : ''}`}
        href={pageUrl(null)}
        {...on('click', navigate(null), { prevent: true })}
      >
        <span>All</span>
        <span class="rail-count">{vm.visible}</span>
      </a>
      {vm.groups.map((g) => (
        <a
          class={`rail-link${g.rows.length === 0 && g.total === 0 ? ' rail-link-clean' : ''}${
            vm.page === g.kind ? ' rail-link-active' : ''
          }`}
          href={pageUrl(g.kind)}
          {...on('click', navigate(g.kind), { prevent: true })}
        >
          <span>{g.kind}</span>
          {g.total === 0 && g.scannedAt === null ? (
            <span class="rail-count rail-never">—</span>
          ) : g.rows.length === 0 && g.total === 0 ? (
            <span class="rail-check">✓</span>
          ) : (
            <span class="rail-count">{g.rows.length}</span>
          )}
        </a>
      ))}
    </nav>
    <div class="rail-foot">
      <span class="burndown">
        {vm.total} divergence{vm.total === 1 ? '' : 's'} · {vm.ignored} ignored
      </span>
    </div>
  </aside>
)

const DirChip = ({ dir, vm }: { dir: State.Direction; vm: VM }) => {
  const active = vm.dirs.includes(dir)
  const count = pageGroups(vm)
    .flatMap((g) => g.rows)
    .filter((r) => r.dir === dir).length
  return (
    <button
      type="button"
      class={`chip chip-${dir}${active ? ' chip-on' : ''}`}
      {...on('click', routes.dir.action({ dir }))}
    >
      {BADGE[dir]}
      {active ? <span class="chip-count">{count}</span> : null}
    </button>
  )
}

export const ScanChips = ({ vm }: { vm: VM }) => (
  <span class="scanchips">
    {vm.groups
      .filter((g) => g.scannedAt !== undefined)
      .map((g) => (
        <span
          class={`scanchip${g.scannedAt == null ? ' scanchip-never' : ''}`}
          title={g.scannedAt == null ? 'no successful scan yet' : g.scannedAt}
        >
          {g.kind} · {g.scannedAt == null ? 'never' : ago(g.scannedAt, vm.now)}
        </span>
      ))}
  </span>
)

export const DirChips = ({ vm }: { vm: VM }) => (
  <span class="chips" id="dirchips">
    {State.DIRECTIONS.map((dir) => (
      <DirChip dir={dir} vm={vm} />
    ))}
  </span>
)

export const ScanArea = ({ vm }: { vm: VM }) => (
  <span class="topbar-right" id="scanarea">
    <ScanChips vm={vm} />
    <button type="button" class="btn-ghost" {...on('click', routes.scan.action())}>
      Rescan
    </button>
    <span class="scan-status" {...text(ui.$.scan)} />
  </span>
)

export const TopBar = ({ vm }: { vm: VM }) => (
  <header class="topbar">
    <h1>diff</h1>
    <input
      type="search"
      class="filter-input"
      placeholder="filter by name or path…"
      {...bind(ui.$.q)}
      {...on('input', routes.filter.action(), { debounceMs: 250 })}
    />
    <DirChips vm={vm} />
    <ScanArea vm={vm} />
  </header>
)

export const BulkBar = ({ vm }: { vm: VM }) => {
  return (
    <div class={`bulkbar${vm.selectedCount === 0 ? ' bulkbar-hidden' : ''}`} id="bulkbar">
      <span class="bulk-count">
        {vm.selectedCount} selected
        {vm.hidden > 0 ? <span class="bulk-hidden"> ({vm.hidden} hidden by filter)</span> : null}
      </span>
      <button type="button" class="btn-ghost" {...on('click', routes.bulkIgnore.action())}>
        Ignore
      </button>
      <button type="button" class="btn-ghost" disabled title="adopt lands in M3">
        Adopt
      </button>
      <button type="button" class="btn-ghost" {...on('click', routes.clearSelection.action())}>
        Clear
      </button>
    </div>
  )
}

export type Notice = { kind: 'ok' | 'err'; msg: string } | null

export const Toast = ({ notice }: { notice: Notice }) => (
  <div class={`toast${notice ? ` toast-${notice.kind}` : ' toast-hidden'}`} id="toast">
    {notice?.msg ?? ''}
  </div>
)

const PageHead = ({ vm }: { vm: VM }) => {
  const g = vm.page === null ? null : pageGroups(vm)[0]
  if (!g) {
    return (
      <header class="page-head">
        <h1 class="page-title">All</h1>
        <p class="page-sub">
          {vm.total} divergence{vm.total === 1 ? '' : 's'} · {vm.ignored} ignored
        </p>
      </header>
    )
  }
  return (
    <header class="page-head">
      <h1 class="page-title">{g.kind}</h1>
      <p class="page-sub">
        {g.total} divergence{g.total === 1 ? '' : 's'}
        {g.scannedAt !== undefined
          ? ` · ${g.scannedAt === null ? 'never scanned' : `scanned ${ago(g.scannedAt, vm.now)}`}`
          : ''}
      </p>
    </header>
  )
}

export const DiffContent = ({ vm }: { vm: VM }) => (
  <main class="content" id="diff-content">
    <PageHead vm={vm} />
    {vm.page !== null ? (
      pageGroups(vm).map((g) => <GroupCard g={g} vm={vm} />)
    ) : vm.visible === 0 && vm.total === 0 ? (
      <CleanState vm={vm} />
    ) : (
      vm.groups
        .filter((g) => (vm.filtered ? g.rows.length > 0 : g.total > 0 || g.scannedAt !== undefined))
        .map((g) => <GroupCard g={g} vm={vm} />)
    )}
  </main>
)

export const DiffPage = ({ vm, cssHref }: { vm: VM; cssHref: string }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>bicycle diff</title>
      <script type="module" src="/static/datastar.js" />
      <script dangerouslySetInnerHTML={{ __html: "addEventListener('popstate', () => location.reload())" }} />
      <link rel="stylesheet" href="/static/base.css" />
      <link rel="stylesheet" href={cssHref} />
    </head>
    <body {...ui.seed({ q: '', shift: false, diff: '', scan: '' })} id="top">
      <div class="shell">
        <Rail vm={vm} />
        <div class="main">
          <TopBar vm={vm} />
          <DiffContent vm={vm} />
        </div>
        <BulkBar vm={vm} />
        <Toast notice={null} />
      </div>
    </body>
  </html>
)
