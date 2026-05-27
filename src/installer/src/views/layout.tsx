import type { Child } from 'hono/jsx'
import type { CategoryId } from '../ui-state';
import type { Warning } from '../config/preflight'


type Category = { id: CategoryId; label: string }

export const CATEGORIES: Category[] = [
  { id: 'system', label: 'System' },
  { id: 'users', label: 'Users' },
  { id: 'disk', label: 'Disk' },
  { id: 'pacman', label: 'Pacman' },
  { id: 'boot', label: 'Boot' },
  { id: 'import', label: 'Import' },
]

const matchExpr = (label: string): string => {
  const haystack = label.toLowerCase().replace(/'/g, "\\'")
  return `!$q || '${haystack}'.includes($q.toLowerCase())`
}

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
            const target = w.category ? `/config/${w.category}` : null
            const nav = target
              ? `history.pushState({}, '', '${target}'); $activeCat = '${w.category}'; @get('${target}')`
              : null
            const content = (
              <>
                <span class={`warnings-dot warnings-dot-${w.severity}`} aria-hidden="true" />
                <span class="warnings-msg">{w.message}</span>
              </>
            )
            return (
              <li class={`warnings-item warnings-item-${w.severity}`}>
                {target ? (
                  <a class="warnings-link" href={target} data-on:click__prevent={nav!}>
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
}) => {
  const nav = (id: CategoryId) =>
    `history.pushState({}, '', '/config/${id}'); $activeCat = '${id}'; @get('/config/${id}')`
  const navInstall =
    `history.pushState({}, '', '/install'); $activeCat = 'install'; @get('/install')`

  const Sidebar = ({ active }: { active: CategoryId | 'install' }) => (
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
        <a
          href="/install"
          class={`btn-install${active === 'install' ? ' btn-install-active' : ''}`}
          data-class:btn-install-active="$activeCat === 'install'"
          data-on:click__prevent={navInstall}
        >
          Install
        </a>
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
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var mo=null, atBottom=true, el=null;
            function attach(node){
              if(mo) mo.disconnect();
              el=node; atBottom=true; node.scrollTop=node.scrollHeight;
              node.addEventListener('scroll',function(){
                atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 8;
              });
              mo = new MutationObserver(function(){
                if(atBottom) node.scrollTop = node.scrollHeight;
              });
              mo.observe(node, {subtree:true, childList:true, characterData:true});
            }
            setInterval(function(){
              var node = document.getElementById('install-log');
              if(node && node !== el) attach(node);
              else if(!node && el){ if(mo) mo.disconnect(); mo=null; el=null; }
            }, 400);
          })();
        ` }} />
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
