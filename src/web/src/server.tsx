import { Hono } from 'hono'
import type { FC } from 'hono/jsx'

const Layout: FC<{ title: string }> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="utf-8" />
      <title>{title}</title>
      <style>{`
        :root { color-scheme: light dark; }
        body {
          font-family: system-ui, sans-serif;
          max-width: 40rem;
          margin: 4rem auto;
          padding: 0 1rem;
          line-height: 1.5;
        }
        h1 { color: #1793d1; }
        code {
          background: color-mix(in srgb, currentColor 10%, transparent);
          padding: 0.1em 0.3em;
          border-radius: 0.2em;
        }
      `}</style>
    </head>
    <body>{children}</body>
  </html>
)

const app = new Hono()

app.get('/', (c) =>
  c.html(
    <Layout title="Arch Installer">
      <h1>Arch Installer</h1>
      <p>
        Served by <code>bun + hono + jsx</code> from the live ISO.
      </p>
      <p>
        API: <a href="/api/hello"><code>/api/hello</code></a>
      </p>
    </Layout>,
  ),
)

app.get('/api/hello', (c) =>
  c.json({ hello: 'from the archinstall POC VM' }),
)

export default { port: 8080, fetch: app.fetch }
