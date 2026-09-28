import { Hono } from 'hono'
import { DiffSchema } from '@bicycle/shared'
import { kinds, detect, ignorefile } from '@bicycle/daemon'
import { type App, type AppContext, readSignals, sse, type Stream } from '@bicycle/datastar'
import datastarPath from '@bicycle/datastar/client' with { type: 'file' }
import baseCssPath from '@bicycle/ui/base.css' with { type: 'file' }
import diffCssPath from './assets/diff.css' with { type: 'file' }
import * as state from './state'
import {
  DiffPage, DiffContent, Rail, BulkBar, DirChips, ScanArea, Toast,
  buildVM, ui, routes, type Notice,
} from './views/diff'
import * as hosts from './views/hosts'

const app = new Hono<{ Variables: App }>()

app.use('*', readSignals)

const staticFile = (path: string, type: string) => () =>
  new Response(Bun.file(path), { headers: { 'content-type': type } })

app.get('/static/datastar.js', staticFile(datastarPath, 'application/javascript; charset=utf-8'))
app.get('/static/base.css', staticFile(baseCssPath, 'text/css; charset=utf-8'))
app.get('/static/diff.css', staticFile(diffCssPath, 'text/css; charset=utf-8'))

app.get('/', (c) => c.html(<hosts.HostsPage vm={hosts.buildVM()} />))

// Planning runs every detector read (pacman, systemctl, getent) — hundreds
// of ms. Selection, filtering, and expansion don't change the diffs, so
// they reuse the cached plan and round-trip in single-digit ms; anything
// that mutates state (ignore, apply, scan) invalidates.
let planCache: kinds.PlanResult | null = null

const getPlan = async (): Promise<kinds.PlanResult> => {
  if (!planCache) planCache = await kinds.plan()
  return planCache
}

const invalidatePlan = (): void => {
  planCache = null
}

// '/diff' is the all-kinds overview; '/diff/:kind' is one category's page.
// Rail clicks arrive as datastar GETs and morph fragments off the cached
// plan; a real page load is the natural refresh gesture and replans.
const diffPage = async (c: AppContext, kind: string | null) => {
  if (!c.get('datastar')) invalidatePlan()
  const plan = await getPlan()
  if (kind !== null && !plan.kinds.some((k) => k.kind === kind)) {
    return c.redirect(routes.diff.url())
  }
  state.nav.page = kind
  if (!c.get('datastar')) {
    return c.html(<DiffPage vm={buildVM(plan)} cssHref="/static/diff.css" />)
  }
  return patched()
}

app[routes.diff.method](routes.diff.path, (c) => diffPage(c, null))
app.get('/diff/:kind', (c) => diffPage(c, c.req.param('kind')))

// Every mutation re-renders the dynamic fragments. The filter input itself
// is never patched, so typing focus survives morphs.
const patchFragments = async (stream: Stream, notice: Notice = null) => {
  const vm = buildVM(await getPlan())
  stream.html(<Rail vm={vm} />)
  stream.html(<DiffContent vm={vm} />)
  stream.html(<BulkBar vm={vm} />)
  stream.html(<DirChips vm={vm} />)
  stream.html(<ScanArea vm={vm} />)
  stream.html(<Toast notice={notice} />)
}

const patched = (notice: Notice = null) => sse((stream) => patchFragments(stream, notice))

app[routes.filter.method](routes.filter.path, (c: AppContext) => {
  state.filter.q = ui.read(c).q
  return patched()
})

app[routes.dir.method](routes.dir.path, (c: AppContext) => {
  const { dir } = routes.dir.params(c)
  if (state.filter.dirs.has(dir)) state.filter.dirs.delete(dir)
  else state.filter.dirs.add(dir)
  return patched()
})

app[routes.select.method](routes.select.path, (c: AppContext) => {
  const { id } = routes.select.params(c)
  state.toggle(id, ui.read(c).shift)
  return patched()
})

app[routes.selectGroup.method](routes.selectGroup.path, (c: AppContext) => {
  const { kind } = routes.selectGroup.params(c)
  state.toggleGroup(kind)
  return patched()
})

app[routes.clearSelection.method](routes.clearSelection.path, () => {
  state.clear()
  return patched()
})

app[routes.bulkIgnore.method](routes.bulkIgnore.path, async () => {
  const picked = [...state.selected().entries()]
  for (const [, ref] of picked) {
    await kinds.resolve(ref.kind, ref.diff, 'ignore')
  }
  state.drop(picked.map(([id]) => id))
  invalidatePlan()
  return patched({
    kind: 'ok',
    msg: `${picked.length} ignored → ignore.yml`,
  })
})

// Single-row ignore from the hover action; the diff rides in the `diff`
// signal because resolve needs more than the identity tuple.
app[routes.resolve.method](routes.resolve.path, async (c: AppContext) => {
  const { kind } = routes.resolve.params(c)
  let raw: unknown
  try {
    raw = JSON.parse(ui.read(c).diff)
  } catch {
    return c.text('invalid diff payload', 400)
  }
  const parsed = DiffSchema.safeParse(raw)
  if (!parsed.success) return c.text('invalid diff payload', 400)
  try {
    await kinds.resolve(kind, parsed.data, 'ignore')
  } catch (e) {
    return c.text(e instanceof Error ? e.message : String(e), 400)
  }
  state.drop([state.rowKey(parsed.data)])
  invalidatePlan()
  return patched({ kind: 'ok', msg: `${parsed.data.id} ignored → ignore.yml` })
})

// Kind-scoped by design: Kind.apply runs the whole reconciler; the button
// is on the group header and confirms client-side before posting.
app[routes.apply.method](routes.apply.path, async (c: AppContext) => {
  const { kind } = routes.apply.params(c)
  const k = kinds.byName(kind)
  if (!k?.apply) return c.text(`kind ${kind} has no apply`, 400)

  // apply() logs failures rather than throwing, so the honest outcome is
  // the before/after diff delta for the kind.
  const before = (await getPlan()).kinds.find((e) => e.kind === kind)?.diffs.length ?? 0
  await k.apply()
  invalidatePlan()
  const after = (await getPlan()).kinds.find((e) => e.kind === kind)?.diffs.length ?? 0
  const notice: Notice =
    after < before
      ? { kind: 'ok', msg: `${kind}: applied — ${before - after} diff(s) resolved, ${after} remain` }
      : {
          kind: 'err',
          msg: `${kind}: apply ran but ${after} diff(s) remain — check the daemon log`,
        }
  return patched(notice)
})

app[routes.scan.method](routes.scan.path, () =>
  sse(async (stream) => {
    stream.signals(ui.patch({ scan: 'scanning…' }))
    let last = 0
    const outcomes = await detect.scan({
      dets: detect.detectors(),
      ignores: ignorefile.effective(),
      claims: kinds.claims(),
      onProgress: (det, p) => {
        const now = Date.now()
        if (now - last < 200) return
        last = now
        stream.signals(ui.patch({ scan: `${det}: ${p.done}${p.total ? `/${p.total}` : ''}` }))
      },
    })
    stream.signals(ui.patch({ scan: '' }))
    if (outcomes === null) {
      stream.html(<Toast notice={{ kind: 'err', msg: 'a scan is already running' }} />)
      return
    }
    invalidatePlan()
    const failed = outcomes.filter((o) => o.error)
    const ok = outcomes.filter((o) => !o.error)
    const notice: Notice = failed.length
      ? {
          kind: 'err',
          msg: `scan failed — ${failed.map((o) => `${o.detector}: ${o.error!.message}`).join('; ')}`,
        }
      : {
          kind: 'ok',
          msg: `scan complete — ${ok.map((o) => `${o.detector}: ${o.findings} finding(s)`).join(', ')}`,
        }
    await patchFragments(stream, notice)
  }),
)

const hostname = Bun.env.HOST ?? '127.0.0.1'
const port = Number(Bun.env.PORT ?? 8081)
Bun.serve({ hostname, port, fetch: app.fetch })
console.log(`bicycle web on ${hostname}:${port}`)
