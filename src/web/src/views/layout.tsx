import type { Child } from 'hono/jsx'
import type { CategoryId } from '../ui-state';


type SubCategory = { id: string; label: string }
type Category = { id: CategoryId; label: string; subs?: SubCategory[] }

export const CATEGORIES: Category[] = [
  {
    id: 'system',
    label: 'System',
    subs: [
      { id: 'hostname', label: 'Hostname' },
      { id: 'locale', label: 'Locale' },
      { id: 'time', label: 'Time' },
      { id: 'network', label: 'Network' },
    ],
  },
  { id: 'users', label: 'Users' },
  {
    id: 'disk',
    label: 'Disk',
    subs: [
      { id: 'partitions', label: 'Partitions' },
      { id: 'swap', label: 'Swap' },
    ],
  },
  {
    id: 'pacman',
    label: 'Pacman',
    subs: [
      { id: 'packages', label: 'Packages' },
      { id: 'mirrors', label: 'Mirrors' },
    ],
  },
  {
    id: 'boot',
    label: 'Boot',
    subs: [
      { id: 'kernels', label: 'Kernels' },
      { id: 'bootloader', label: 'Bootloader' },
    ],
  },
]

const norm = (s: string): string => s.toLowerCase()

const matchExpr = (terms: string[]): string => {
  const haystack = norm(terms.join(' ')).replace(/'/g, "\\'")
  return `!$q || '${haystack}'.includes($q.toLowerCase())`
}

export const Preview = ({ html }: { html: string }) => (
  <aside id="config-preview" class="preview">
    <div class="preview-head">bicycle.toml</div>
    <div class="preview-body" dangerouslySetInnerHTML={{ __html: html }} />
  </aside>
)

export const Layout = ({
  active,
  activeSub = '',
  title = 'Bicycle',
  previewHtml,
  children,
}: {
  active: CategoryId
  activeSub?: string
  title?: string
  previewHtml: string
  children?: Child
}) => {
  const navParent = (id: CategoryId) =>
    `history.pushState({}, '', '/config/${id}'); $activeCat = '${id}'; $activeSub = ''; @get('/config/${id}')`

  const navSub = (id: CategoryId, sub: string) =>
    `history.pushState({}, '', '/config/${id}#${sub}'); $activeCat = '${id}'; $activeSub = '${sub}'; @get('/config/${id}?h=${sub}')`

  const Sidebar = ({ active, activeSub }: { active: CategoryId; activeSub: string }) => (
    <aside
      class="sidebar"
      data-signals={JSON.stringify({ q: '', activeCat: active, activeSub })}
      data-on:active-sub__window="$activeSub = evt.detail"
    >
      <a class="brand" href="/">{'>>'} bicycle</a>
      <input
        class="nav-filter"
        type="text"
        placeholder="Filter…"
        data-bind="q"
      />
      <nav class="nav">
        {CATEGORIES.map((c) => {
          const subLabels = c.subs?.map((s) => s.label) ?? []
          const parentMatch = matchExpr([c.label, ...subLabels])
          return (
            <>
              <a
                href={`/config/${c.id}`}
                class={`nav-link${c.id === active ? ' nav-link-active' : ''}`}
                data-class:nav-link-active={`$activeCat === '${c.id}'`}
                data-on:click__prevent={navParent(c.id)}
                data-show={parentMatch}
              >
                {c.label}
              </a>
              {c.subs?.map((s) => (
                <a
                  href={`/config/${c.id}#${s.id}`}
                  class={`nav-link nav-sublink${c.id === active && s.id === activeSub ? ' nav-link-active' : ''}`}
                  data-class:nav-link-active={`$activeCat === '${c.id}' && $activeSub === '${s.id}'`}
                  data-on:click__prevent={navSub(c.id, s.id)}
                  data-show={matchExpr([c.label, s.label])}
                >
                  {s.label}
                </a>
              ))}
            </>
          )
        })}
      </nav>
      <div class="sidebar-foot">
        <button type="button" class="btn-install" disabled>
          Install
        </button>
      </div>
    </aside>
  )

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="stylesheet" href="/static/app.css" />
        <script type="module" src="/static/datastar.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              addEventListener('popstate',()=>location.reload());
              let _spyTick;
              const _spyUpdate = () => {
                const sections = document.querySelectorAll('main .section');
                if (!sections.length) return;
                let active = sections[0].id;
                for (const s of sections) {
                  if (s.getBoundingClientRect().top <= 120) active = s.id;
                  else break;
                }
                window.dispatchEvent(new CustomEvent('active-sub', { detail: active }));
              };
              const _onScroll = () => {
                if (_spyTick) return;
                _spyTick = requestAnimationFrame(() => { _spyTick = 0; _spyUpdate(); });
              };
              window.bicycleScrollSpy = () => {
                removeEventListener('scroll', _onScroll);
                addEventListener('scroll', _onScroll, { passive: true });
                _spyUpdate();
              };
            `,
          }}
        />
      </head>
      <body>
        <div class="shell">
          <Sidebar active={active} activeSub={activeSub} />
          <main id="page-content" class="content">{children}</main>
          <Preview html={previewHtml} />
        </div>
      </body>
    </html>
  )
}

export const Page = ({
  heading,
  subhead,
  children,
}: {
  heading: string
  subhead?: string
  children?: Child
}) => (
  <section class="page">
    <header class="page-head">
      <h1 class="page-title">{heading}</h1>
      {subhead ? <p class="page-sub">{subhead}</p> : null}
    </header>
    <div class="page-body">{children}</div>
  </section>
)

export const Section = ({
  id,
  title,
  subhead,
  children,
}: {
  id: string
  title: string
  subhead?: string
  children?: Child
}) => (
  <section id={id} class="section" data-init="bicycleScrollSpy()">
    <header class="section-head">
      <h2 class="section-title">{title}</h2>
      {subhead ? <p class="section-sub">{subhead}</p> : null}
    </header>
    <div class="section-body">{children}</div>
  </section>
)

export const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children?: Child
}) => (
  <div class="field">
    <label class="field-label" for={htmlFor}>
      {label}
    </label>
    <div class="field-control">{children}</div>
  </div>
)
