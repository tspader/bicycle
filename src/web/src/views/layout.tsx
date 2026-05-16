import type { Child } from 'hono/jsx'
import type { CategoryId } from '../ui-state';


type Category = { id: CategoryId; label: string }

export const CATEGORIES: Category[] = [
  { id: 'system', label: 'System' },
  { id: 'users', label: 'Users' },
  { id: 'disk', label: 'Disk' },
  { id: 'pacman', label: 'Pacman' },
  { id: 'boot', label: 'Boot' },
]

const matchExpr = (label: string): string => {
  const haystack = label.toLowerCase().replace(/'/g, "\\'")
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
  title = 'Bicycle',
  previewHtml,
  children,
}: {
  active: CategoryId
  title?: string
  previewHtml: string
  children?: Child
}) => {
  const nav = (id: CategoryId) =>
    `history.pushState({}, '', '/config/${id}'); $activeCat = '${id}'; @get('/config/${id}')`

  const Sidebar = ({ active }: { active: CategoryId }) => (
    <aside
      class="sidebar"
      data-signals={JSON.stringify({ q: '', activeCat: active })}
    >
      <a class="brand" href="/">{'>>'} bicycle</a>
      <input
        class="nav-filter"
        type="text"
        placeholder="Filter…"
        data-bind="q"
      />
      <nav class="nav">
        {CATEGORIES.map((c) => (
          <a
            href={`/config/${c.id}`}
            class={`nav-link${c.id === active ? ' nav-link-active' : ''}`}
            data-class:nav-link-active={`$activeCat === '${c.id}'`}
            data-on:click__prevent={nav(c.id)}
            data-show={matchExpr(c.label)}
          >
            {c.label}
          </a>
        ))}
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
        <script dangerouslySetInnerHTML={{ __html: `addEventListener('popstate',()=>location.reload());` }} />
      </head>
      <body>
        <div class="shell">
          <Sidebar active={active} />
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
  title,
  subhead,
  children,
}: {
  title: string
  subhead?: string
  children?: Child
}) => (
  <section class="section">
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
