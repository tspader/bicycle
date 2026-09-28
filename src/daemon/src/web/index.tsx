/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { DiffSchema } from '@bicycle/shared'
import { Clock } from '@bicycle/core/clock'
import { Detect } from '@bicycle/core/detect'
import type { Host } from '@bicycle/core/host'
import { Ignores } from '@bicycle/core/ignores'
import { Kinds } from '@bicycle/core/kinds'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { type App, type AppContext, readSignals, sse, type Stream } from '@bicycle/datastar'
import datastarPath from '@bicycle/datastar/client' with { type: 'file' }
import baseCssPath from '@bicycle/ui/base.css' with { type: 'file' }
import diffCssPath from '@bicycle/daemon/web/assets/diff.css' with { type: 'file' }
import { Jobs } from '@bicycle/daemon/jobs'
import { State } from '@bicycle/daemon/web/state'
import {
  DiffPage,
  DiffContent,
  Rail,
  BulkBar,
  DirChips,
  ScanArea,
  Toast,
  buildVM,
  ui,
  routes as at,
  type Notice,
} from '@bicycle/daemon/web/views/diff'
import { HostsPage, buildVM as hosts } from '@bicycle/daemon/web/views/hosts'

export namespace Web {
  export const POLL = 100

  const file = (path: string, type: string) => () => new Response(Bun.file(path), { headers: { 'content-type': type } })

  function json(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  const count = (plan: Kinds.Plan, kind: string): number =>
    plan.kinds.find((entry) => entry.kind === kind)?.diffs.length ?? 0

  const scanned = (job: Jobs.Job): Notice => {
    const failed = job.outcomes.flatMap((o) => (o.kind === 'failed' ? [`${o.detector}: ${o.message}`] : []))
    const found = job.outcomes.flatMap((o) => (o.kind === 'scanned' ? [`${o.detector}: ${o.findings} finding(s)`] : []))
    if (job.failure !== null) return { kind: 'err', msg: `scan failed — ${job.failure}` }
    if (failed.length > 0) return { kind: 'err', msg: `scan failed — ${failed.join('; ')}` }
    return { kind: 'ok', msg: `scan complete — ${found.join(', ')}` }
  }

  export function routes(host: Host, queue: Jobs.Queue): Hono<{ Variables: App }> {
    const app = new Hono<{ Variables: App }>()
    const session = State.create()
    const cache: { plan: Kinds.Plan | null } = { plan: null }

    const settled = async (job: Jobs.Job, each: (job: Jobs.Job) => void): Promise<void> => {
      while (!Jobs.terminal(job.status)) {
        each(job)
        await Clock.sleep(host.clock, POLL)
      }
    }

    const planned = async (): Promise<Kinds.Plan> => (cache.plan ??= await Kinds.plan(host, Kinds.names(host)))

    const fragments = async (stream: Stream, notice: Notice): Promise<void> => {
      const vm = buildVM(await planned(), session, host.clock.now())
      stream.html(<Rail vm={vm} />)
      stream.html(<DiffContent vm={vm} />)
      stream.html(<BulkBar vm={vm} />)
      stream.html(<DirChips vm={vm} />)
      stream.html(<ScanArea vm={vm} />)
      stream.html(<Toast notice={notice} />)
    }

    const patched = (notice: Notice = null) => sse((stream) => fragments(stream, notice))

    const ignore = (picked: State.Ref[]): void => {
      for (const ref of picked) Ignores.add(host, Ignores.entry(ref.diff))
      State.drop(
        session,
        picked.map((ref) => State.key(ref.diff)),
      )
      cache.plan = null
    }

    const page = async (c: AppContext, kind: string | null) => {
      if (!c.get('datastar')) cache.plan = null
      const plan = await planned()
      if (kind !== null && !plan.kinds.some((k) => k.kind === kind)) return c.redirect(at.diff.url())
      session.page = kind
      if (c.get('datastar')) return patched()
      return c.html(<DiffPage vm={buildVM(plan, session, host.clock.now())} cssHref="/static/diff.css" />)
    }

    app.use('*', readSignals)

    app.get('/static/datastar.js', file(datastarPath, 'application/javascript; charset=utf-8'))
    app.get('/static/base.css', file(baseCssPath, 'text/css; charset=utf-8'))
    app.get('/static/diff.css', file(diffCssPath, 'text/css; charset=utf-8'))

    app.get('/', (c) => c.html(<HostsPage vm={hosts(host)} />))

    app[at.diff.method](at.diff.path, (c) => page(c, null))
    app.get('/diff/:kind', (c) => page(c, c.req.param('kind')))

    app[at.filter.method](at.filter.path, (c: AppContext) => {
      session.q = ui.read(c).q
      return patched()
    })

    app[at.dir.method](at.dir.path, (c: AppContext) => {
      State.flip(session, at.dir.params(c).dir)
      return patched()
    })

    app[at.select.method](at.select.path, (c: AppContext) => {
      const { id } = at.select.params(c)
      if (ui.read(c).shift) State.extend(session, id)
      else State.toggle(session, id)
      return patched()
    })

    app[at.selectGroup.method](at.selectGroup.path, (c: AppContext) => {
      State.group(session, at.selectGroup.params(c).kind)
      return patched()
    })

    app[at.clearSelection.method](at.clearSelection.path, () => {
      State.clear(session)
      return patched()
    })

    app[at.bulkIgnore.method](at.bulkIgnore.path, () => {
      const picked = [...session.selection.values()]
      ignore(picked)
      return patched({ kind: 'ok', msg: `${picked.length} ignored → ignore.yml` })
    })

    app[at.resolve.method](at.resolve.path, (c: AppContext) => {
      const { kind } = at.resolve.params(c)
      const parsed = DiffSchema.safeParse(json(ui.read(c).diff))
      if (!parsed.success) return c.text('invalid diff payload', 400)
      ignore([{ kind, diff: parsed.data }])
      return patched({ kind: 'ok', msg: `${parsed.data.id} ignored → ignore.yml` })
    })

    app[at.apply.method](at.apply.path, async (c: AppContext) => {
      const name = Reconcilers.Name.safeParse(at.apply.params(c).kind)
      if (!name.success) return c.text(`kind ${at.apply.params(c).kind} has no apply`, 400)
      const kind = name.data
      const before = count(await planned(), kind)
      const job = Jobs.submit(queue, { kind: 'reconcile', only: [kind] }, 'web', 0)
      await settled(job, () => {})
      cache.plan = null
      const after = count(await planned(), kind)
      return patched(
        after < before
          ? { kind: 'ok', msg: `${kind}: applied — ${before - after} diff(s) resolved, ${after} remain` }
          : { kind: 'err', msg: `${kind}: apply ran but ${after} diff(s) remain — see bicycle jobs ${job.id}` },
      )
    })

    app[at.scan.method](at.scan.path, () =>
      sse(async (stream) => {
        const job = Jobs.submit(
          queue,
          {
            kind: 'scan',
            only: Detect.detectors(host).map((det) => det.name),
            priority: 'idle',
            timeout: Detect.TIMEOUT,
          },
          'web',
          0,
        )
        stream.signals(ui.patch({ scan: 'scanning…' }))
        await settled(job, ({ progress: p }) => {
          if (p !== null) stream.signals(ui.patch({ scan: `${p.detector}: ${p.done}${p.total ? `/${p.total}` : ''}` }))
        })
        stream.signals(ui.patch({ scan: '' }))
        cache.plan = null
        await fragments(stream, scanned(job))
      }),
    )

    return app
  }
}
