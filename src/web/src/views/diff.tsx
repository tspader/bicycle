import { z } from 'zod'
import type { Child } from 'hono/jsx'
import type { Diff } from '@bicycle/shared'
import { kinds } from '@bicycle/daemon'
import { signals, route, on, expr, seq, when, bind, text, type Code } from '@bicycle/datastar'
import * as state from '../state'

export type { Diff }

// q is bound to the filter input; shift ferries evt.shiftKey to /select;
// diff carries a single row's JSON to /resolve; scan is the live status line.
export const ui = signals({
  q: z.string().default(''),
  shift: z.coerce.boolean().default(false),
  diff: z.string().default(''),
  scan: z.string().default(''),
})

export const routes = {
  diff: route('get', '/diff'),
  filter: route('post', '/filter'),
  dir: route('post', '/dir', { dir: z.enum(['drift', 'missing', 'undeclared']) }),
  select: route('post', '/select', { id: z.string().min(1) }),
  expand: route('post', '/expand', { id: z.string().min(1) }),
  selectGroup: route('post', '/select-group', { kind: z.string().min(1) }),
  clearSelection: route('post', '/clear-selection'),
  bulkIgnore: route('post', '/bulk-ignore'),
  resolve: route('post', '/resolve', { kind: z.string().min(1) }),
  apply: route('post', '/apply', { kind: z.string().min(1) }),
  scan: route('post', '/scan'),
}

// ── view model ───────────────────────────────────────────────────────

export type Row = {
  id: string
  kind: string
  diff: Diff
  dir: state.Direction
  selected: boolean
}

export type GroupVM = {
  kind: string
  rows: Row[] // visible only, sorted
  total: number // unfiltered diff count
  applicable: number // what apply-all would act on
  scannedAt?: string | null
}

export type VM = {
  groups: GroupVM[]
  total: number
  visible: number
  ignored: number
  selectedCount: number
}

const DIR_ORDER: Record<state.Direction, number> = { drift: 0, missing: 1, undeclared: 2 }

const matches = (d: Diff, dir: state.Direction): boolean => {
  if (!state.filter.dirs.has(dir)) return false
  const q = state.filter.q.trim().toLowerCase()
  return q === '' || d.id.toLowerCase().includes(q) || d.type.toLowerCase().includes(q)
}

// Builds the view model and (re)registers row order + selection pruning —
// call exactly once per render.
export const buildVM = (plan: kinds.PlanResult): VM => {
  const groups: GroupVM[] = []
  const order: string[] = []
  const known = new Map<string, state.RowRef>()

  for (const kp of plan.kinds) {
    const sorted = [...kp.diffs].sort((a, b) => {
      const da = DIR_ORDER[state.direction(a)] - DIR_ORDER[state.direction(b)]
      return da !== 0 ? da : a.id.localeCompare(b.id)
    })
    const rows: Row[] = []
    for (const d of sorted) {
      const id = state.rowKey(d)
      known.set(id, { kind: kp.kind, diff: d })
      if (!matches(d, state.direction(d))) continue
      order.push(id)
      rows.push({ id, kind: kp.kind, diff: d, dir: state.direction(d), selected: false })
    }
    groups.push({
      kind: kp.kind,
      rows,
      total: kp.diffs.length,
      applicable: kinds.byName(kp.kind)?.apply
        ? kp.diffs.filter((d) => d.expected !== null).length
        : 0,
      scannedAt: kp.scannedAt,
    })
  }

  state.setOrder(order, known)
  for (const g of groups) for (const r of g.rows) r.selected = state.isSelected(r.id)

  return {
    groups,
    total: plan.diffs.length,
    visible: order.length,
    ignored: plan.ignored,
    selectedCount: state.selected().size,
  }
}

// ── formatting ───────────────────────────────────────────────────────

const SHA256_HEX = /^[0-9a-f]{64}$/

const fmtValue = (v: Diff['expected']): string => {
  if (v === null) return '—'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'string' && SHA256_HEX.test(v)) return v.slice(0, 10)
  return String(v)
}

const ago = (iso: string): string => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

const BADGE: Record<state.Direction, string> = {
  drift: 'drift',
  missing: 'missing',
  undeclared: 'undeclared',
}

// ── row ──────────────────────────────────────────────────────────────

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

const Detail = ({ d, open }: { d: Diff; open: boolean }) => (
  <div class="rowdetail" hidden={!open}>
    <dl>
      <dt>actual</dt>
      <dd>{d.actual === null ? '—' : String(d.actual)}</dd>
      <dt>expected</dt>
      <dd>{d.expected === null ? '—' : String(d.expected)}</dd>
      {Object.entries(d.meta ?? {}).map(([k, v]) => (
        <>
          <dt>{k}</dt>
          <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
        </>
      ))}
    </dl>
  </div>
)

const rowClick = (action: Code): Code =>
  when(expr`!evt.target.closest('button, input, a, .rowdetail')`, action)

// Per-kind custom renderers plug in here (m2 §8): key is the registry kind
// name, the generic row covers every kind today.
const renderers: Record<string, (r: Row) => Child> = {}

const DefaultRow = ({ r }: { r: Row }) => {
  const d = r.diff
  const hasDetail = d.meta !== undefined || typeof d.expected === 'string' || typeof d.actual === 'string'
  const open = state.expanded.has(r.id)
  const tautological =
    (r.dir === 'undeclared' || r.dir === 'missing') &&
    (d.field === 'exists' || d.field === 'installed' || d.field === 'enabled')
  return (
    <div class={`roww${r.selected ? ' is-selected' : ''}`} id={r.id}>
      <div
        class="row rowgrid"
        {...on(
          'click',
          rowClick(seq(ui.$.shift.set(expr`evt.shiftKey`), routes.select.action({ id: r.id }))),
        )}
      >
        <span class="cell-check">
          <input type="checkbox" checked={r.selected} tabindex={-1} aria-label="select row" />
        </span>
        <span class={`badge badge-${r.dir}`}>{BADGE[r.dir]}</span>
        <Ident id={d.id} />
        <span class={`field${tautological ? ' field-dim' : ''}`}>{d.field}</span>
        <span class="values">
          {r.dir === 'undeclared' ? (
            // A bare presence boolean restates the badge; show it as a dash.
            typeof d.actual === 'boolean' ? (
              <span class="val val-dim">—</span>
            ) : (
              <span class="val">{fmtValue(d.actual)}</span>
            )
          ) : r.dir === 'missing' ? (
            // What the repo declares and the machine lacks.
            typeof d.expected === 'boolean' ? (
              <span class="val val-dim">—</span>
            ) : (
              <span class="val val-dim">expected {fmtValue(d.expected)}</span>
            )
          ) : (
            // Destination (declared value) carries the emphasis.
            <>
              <span class="val val-was">{fmtValue(d.actual)}</span>
              <span class="arrow"> → </span>
              <span class="val val-target">{fmtValue(d.expected)}</span>
            </>
          )}
          {d.redacted ? <span class="redacted"> redacted</span> : null}
        </span>
        <span class="cell-chevron">
          {hasDetail ? (
            <button
              type="button"
              class={`chevron${open ? ' chevron-open' : ''}`}
              aria-label="details"
              aria-expanded={open}
              {...on('click', routes.expand.action({ id: r.id }), { stop: true })}
            >
              ▸
            </button>
          ) : null}
        </span>
        <span class="rowactions">
          <button
            type="button"
            class="btn-ghost"
            {...on(
              'click',
              seq(ui.$.diff.set(JSON.stringify(d)), routes.resolve.action({ kind: r.kind })),
            )}
          >
            Ignore
          </button>
        </span>
      </div>
      {hasDetail ? <Detail d={d} open={open} /> : null}
    </div>
  )
}

const row = (r: Row): Child => (renderers[r.kind] ?? ((x: Row) => <DefaultRow r={x} />))(r)

// ── groups ───────────────────────────────────────────────────────────

const filtered = (): boolean =>
  state.filter.q.trim() !== '' || state.filter.dirs.size !== state.DIRECTIONS.length

// The confirm body lists what the reconciler will act on (capped), so the
// scary dialog is at least a specific one. expr`` JSON-encodes the hole.
const applyConfirm = (g: GroupVM): string => {
  const acted = g.rows
    .filter((r) => r.dir !== 'undeclared')
    .map((r) => `• ${r.diff.id} (${r.diff.field})`)
  const shown = acted.slice(0, 6)
  const more = g.applicable - shown.length
  return [
    `Apply ${g.kind}: run its reconciler against this machine.`,
    '',
    ...shown,
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join('\n')
}

const GroupCard = ({ g }: { g: GroupVM }) => {
  const allSelected = g.rows.length > 0 && g.rows.every((r) => r.selected)
  return (
    <section class="group" id={`kind-${g.kind}`}>
      <header class="group-head rowgrid">
        <span class="cell-check">
          <input
            type="checkbox"
            checked={allSelected}
            aria-label={`select all ${g.kind}`}
            {...on('click', routes.selectGroup.action({ kind: g.kind }))}
          />
        </span>
        <h2 class="group-name">{g.kind}</h2>
        <span class="group-count">
          {filtered() && g.rows.length !== g.total ? `${g.rows.length} of ${g.total}` : `${g.total}`}
          {g.scannedAt !== undefined ? (
            <span class="group-stale">
              {' · '}
              {g.scannedAt === null ? 'never scanned' : `scanned ${ago(g.scannedAt)}`}
            </span>
          ) : null}
        </span>
        <span />
        <span />
        <span class="group-actions">
          {g.applicable > 0 ? (
            <button
              type="button"
              class="btn-accent"
              title={`runs the whole ${g.kind} reconciler on the machine`}
              {...on(
                'click',
                when(
                  expr`confirm(${applyConfirm(g)})`,
                  routes.apply.action({ kind: g.kind }),
                ),
              )}
            >
              Apply {g.applicable === 1 ? '1 change' : `${g.applicable} changes`}
            </button>
          ) : null}
        </span>
      </header>
      {g.rows.length === 0 ? (
        <p class="group-empty">
          {g.scannedAt === null
            ? 'no data — run a scan'
            : g.total === 0
              ? 'clean'
              : 'nothing matches the filter'}
        </p>
      ) : (
        <div class="rows">{g.rows.map(row)}</div>
      )}
    </section>
  )
}

const CleanState = ({ vm }: { vm: VM }) => (
  <div class="clean">
    <div class="clean-check">✓</div>
    <h2>In sync</h2>
    <p class="clean-sub">
      {vm.ignored > 0 ? `${vm.ignored} ignored · ` : ''}nothing to review
    </p>
  </div>
)

// ── chrome ───────────────────────────────────────────────────────────

export const Rail = ({ vm }: { vm: VM }) => (
  <aside class="rail" id="rail">
    <div class="brand">&gt;&gt; bicycle</div>
    <nav class="rail-nav">
      <a class="rail-link" href="#top">
        <span>All</span>
        <span class="rail-count">{vm.visible}</span>
      </a>
      {vm.groups.map((g) => (
        <a
          class={`rail-link${g.rows.length === 0 && g.total === 0 ? ' rail-link-clean' : ''}`}
          href={`#kind-${g.kind}`}
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

const DirChip = ({ dir, vm }: { dir: state.Direction; vm: VM }) => {
  const active = state.filter.dirs.has(dir)
  const count = vm.groups.flatMap((g) => g.rows).filter((r) => r.dir === dir).length
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
          {g.kind} · {g.scannedAt == null ? 'never' : ago(g.scannedAt)}
        </span>
      ))}
  </span>
)

export const DirChips = ({ vm }: { vm: VM }) => (
  <span class="chips" id="dirchips">
    {state.DIRECTIONS.map((dir) => (
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
  const hidden = state.hiddenSelected()
  return (
    <div class={`bulkbar${vm.selectedCount === 0 ? ' bulkbar-hidden' : ''}`} id="bulkbar">
      <span class="bulk-count">
        {vm.selectedCount} selected
        {hidden > 0 ? <span class="bulk-hidden"> ({hidden} hidden by filter)</span> : null}
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

// One-shot outcome line for the last action; every fragment patch replaces
// it (empty by default), so it naturally clears on the next interaction.
export type Notice = { kind: 'ok' | 'err'; msg: string } | null

export const Toast = ({ notice }: { notice: Notice }) => (
  <div class={`toast${notice ? ` toast-${notice.kind}` : ' toast-hidden'}`} id="toast">
    {notice?.msg ?? ''}
  </div>
)

export const DiffContent = ({ vm }: { vm: VM }) => (
  <main class="content" id="diff-content">
    {vm.visible === 0 && vm.total === 0 ? (
      <CleanState vm={vm} />
    ) : (
      vm.groups
        // While filtering, groups with no matches drop out entirely; at rest,
        // expensive kinds always show so their staleness stays visible.
        .filter((g) =>
          filtered() ? g.rows.length > 0 : g.total > 0 || g.scannedAt !== undefined,
        )
        .map((g) => <GroupCard g={g} />)
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
