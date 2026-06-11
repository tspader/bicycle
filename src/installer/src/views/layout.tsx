import { z } from 'zod'
import type { Child } from 'hono/jsx'
import { CATEGORY_IDS, type CategoryId } from '../ui-state'
import type { Warning } from '../config/preflight'
import {
  type Code, type Props, type Sig,
  signals, expr, seq, eq, get, on, bind, cls, show, text, when,
} from '../datastar'

type Category = { id: CategoryId; label: string }

export const CATEGORIES: Category[] = [
  { id: 'system', label: 'System' },
  { id: 'users', label: 'Users' },
  { id: 'disk', label: 'Disk' },
  { id: 'pacman', label: 'Pacman' },
  { id: 'boot', label: 'Boot' },
  { id: 'import', label: 'Import' },
]

export const ui = signals({
  nav_q: z.string().default(''),
  active_cat: z.enum([...CATEGORY_IDS, 'install']),
})

const pageUrl = (target: CategoryId | 'install'): string =>
  target === 'install' ? '/install' : `/config/${target}`

export const navigate = (target: CategoryId | 'install'): Code<void> =>
  seq(
    expr`history.pushState({}, '', ${pageUrl(target)})`,
    ui.$.active_cat.set(target),
    get(pageUrl(target)),
  )

// Row-level click handlers on tables with embedded inputs: let clicks on the
// input reach the input's own handler instead of triggering the row action.
export const rowClick = (action: Code): Code =>
  when(expr`!evt.target.closest('input')`, action)

export const onOff = (sig: Sig<boolean>): Props => text(expr`${sig} ? 'On' : 'Off'`)

const matchesFilter = (label: string): Code =>
  expr`!${ui.$.nav_q} || ${label.toLowerCase()}.includes(${ui.$.nav_q}.toLowerCase())`

export const Preview = ({ html }: { html: string }) => (
  <section id="config-preview" class="preview">
    <div class="preview-head">bicycle.yml</div>
    <div class="preview-body" dangerouslySetInnerHTML={{ __html: html }} />
  </section>
)

export const Warnings = ({ items }: { items: Warning[] }) => (
  <section id="config-warnings" class="warnings">
    {items.length === 0 ? null : (
      <>
        <div class="warnings-head">Warnings</div>
        <ul class="warnings-list">
          {items.map((w) => {
            const content = (
              <>
                <span class={`warnings-dot warnings-dot-${w.severity}`} aria-hidden="true" />
                <span class="warnings-msg">{w.message}</span>
              </>
            )
            return (
              <li class={`warnings-item warnings-item-${w.severity}`}>
                {w.category ? (
                  <a
                    class="warnings-link"
                    href={pageUrl(w.category)}
                    {...on('click', navigate(w.category), { prevent: true })}
                  >
                    {content}
                  </a>
                ) : (
                  <span class="warnings-link">{content}</span>
                )}
              </li>
            )
          })}
        </ul>
      </>
    )}
  </section>
)

const Sidebar = ({ active }: { active: CategoryId | 'install' }) => (
  <aside class="sidebar" {...ui.seed({ nav_q: '', active_cat: active })}>
    <a class="brand" href="/">{'>>'} bicycle</a>
    <input
      class="nav-filter"
      type="text"
      placeholder="Filter…"
      {...bind(ui.$.nav_q)}
    />
    <nav class="nav">
      {CATEGORIES.map((c) => (
        <a
          href={pageUrl(c.id)}
          class={`nav-link${c.id === active ? ' nav-link-active' : ''}`}
          {...cls('nav-link-active', eq(ui.$.active_cat, c.id))}
          {...on('click', navigate(c.id), { prevent: true })}
          {...show(matchesFilter(c.label))}
        >
          {c.label}
        </a>
      ))}
    </nav>
    <div class="sidebar-foot">
      <a
        href={pageUrl('install')}
        class={`btn-install${active === 'install' ? ' btn-install-active' : ''}`}
        {...cls('btn-install-active', eq(ui.$.active_cat, 'install'))}
        {...on('click', navigate('install'), { prevent: true })}
      >
        Install
      </a>
    </div>
  </aside>
)

export const Layout = ({
  active,
  title = 'Bicycle',
  previewHtml,
  warnings,
  children,
}: {
  active: CategoryId | 'install'
  title?: string
  previewHtml: string
  warnings: Warning[]
  children?: Child
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <link rel="icon" type="image/x-icon" href="/favicon.ico" />
      <link rel="stylesheet" href="/static/app.css" />
      <script type="module" src="/static/datastar.js" />
      <script src="/static/app.js" defer />
    </head>
    <body>
      <div class="shell">
        <Sidebar active={active} />
        <main id="page-content" class="content">{children}</main>
        <aside class="sidecar">
          <Warnings items={warnings} />
          <Preview html={previewHtml} />
        </aside>
      </div>
    </body>
  </html>
)

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
