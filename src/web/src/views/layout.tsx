import type { FC, PropsWithChildren } from 'hono/jsx'

export type CategoryId =
  | 'locale'
  | 'kernels'
  | 'hostname'
  | 'users'
  | 'disk'
  | 'bootloader'
  | 'profile'
  | 'network'
  | 'timezone'
  | 'mirrors'
  | 'packages'
  | 'swap'
  | 'ntp'

type Category = { id: CategoryId; label: string }

export const CATEGORIES: Category[] = [
  { id: 'locale', label: 'Locale' },
  { id: 'kernels', label: 'Kernels' },
  { id: 'hostname', label: 'Hostname' },
  { id: 'users', label: 'Users' },
  { id: 'disk', label: 'Disk' },
  { id: 'bootloader', label: 'Bootloader' },
  { id: 'profile', label: 'Profile' },
  { id: 'network', label: 'Network' },
  { id: 'timezone', label: 'Timezone' },
  { id: 'mirrors', label: 'Mirrors' },
  { id: 'packages', label: 'Packages' },
  { id: 'swap', label: 'Swap' },
  { id: 'ntp', label: 'NTP' },
]

const CriticalCss: FC = () => (
  <style>{`html,body{background:#0e0e0e;color:#e6e6e6}.sidebar{background:#111111}`}</style>
)

export const Layout: FC<PropsWithChildren<{ active: CategoryId; title?: string }>> = ({
  active,
  title = 'Arch Installer',
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <CriticalCss />
      <link rel="stylesheet" href="/static/app.css" />
      <script type="module" src="/static/datastar.js" />
    </head>
    <body>
      <div class="shell">
        <aside class="sidebar">
          <a class="brand" href="/">arch installer</a>
          <nav class="nav">
            {CATEGORIES.map((c) => (
              <a
                href={`/config/${c.id}`}
                class={`nav-link${c.id === active ? ' nav-link-active' : ''}`}
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
        <main class="content">{children}</main>
      </div>
    </body>
  </html>
)

export const Page: FC<PropsWithChildren<{ heading: string; subhead?: string }>> = ({
  heading,
  subhead,
  children,
}) => (
  <section class="page">
    <header class="page-head">
      <h1 class="page-title">{heading}</h1>
      {subhead ? <p class="page-sub">{subhead}</p> : null}
    </header>
    <div class="page-body">{children}</div>
  </section>
)

export const Field: FC<PropsWithChildren<{ label: string; hint?: string; htmlFor?: string }>> = ({
  label,
  hint,
  htmlFor,
  children,
}) => (
  <div class="field">
    <label class="field-label" for={htmlFor}>
      {label}
    </label>
    {children}
    {hint ? <p class="field-hint">{hint}</p> : null}
  </div>
)
