/** @jsxImportSource hono/jsx */
import type { Host } from '@bicycle/core/host'
import { Ingress } from '@bicycle/core/reconcilers/ingress'
import { Tree } from '@bicycle/core/tree'

export type VM = {
  domain: string | null
  routes: Ingress.Route[]
}

export const buildVM = (host: Host): VM => {
  const cfg = Tree.maybe(host)
  if (!cfg?.ingress) return { domain: null, routes: [] }
  return { domain: cfg.ingress.domain, routes: Ingress.current(host, cfg.ingress) }
}

const HostRow = ({ domain, r }: { domain: string; r: Ingress.Route }) => (
  <div class="roww">
    <div class="row rowgrid">
      <a class="ident" href={`http://${r.name}.${domain}`}>
        {r.name}.{domain}
      </a>
      <span class="metacell">{r.port}</span>
      <span />
    </div>
  </div>
)

export const HostsPage = ({ vm }: { vm: VM }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>bicycle</title>
      <link rel="stylesheet" href="/static/base.css" />
      <link rel="stylesheet" href="/static/diff.css" />
    </head>
    <body>
      <div class="shell">
        <aside class="rail">
          <div class="brand">&gt;&gt; bicycle</div>
          <nav class="rail-nav">
            <a class="rail-link rail-link-active" href="/">
              <span>hosts</span>
              <span class="rail-count">{vm.routes.length}</span>
            </a>
            <a class="rail-link" href="/diff">
              <span>diff</span>
            </a>
          </nav>
        </aside>
        <div class="main">
          <main class="content">
            <header class="page-head">
              <h1 class="page-title">hosts</h1>
              <p class="page-sub">{vm.domain ?? 'no ingress configured'}</p>
            </header>
            {vm.domain !== null && vm.routes.length > 0 ? (
              <section class="group" style="--cols: minmax(240px, max-content) 80px 1fr">
                <div class="rows">
                  <div class="collabels rowgrid">
                    <span>host</span>
                    <span>port</span>
                    <span />
                  </div>
                  {vm.routes.map((r) => (
                    <HostRow domain={vm.domain!} r={r} />
                  ))}
                </div>
              </section>
            ) : null}
          </main>
        </div>
      </div>
    </body>
  </html>
)
