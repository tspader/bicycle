import { Hono } from 'hono'
import { z } from 'zod'
import {
  type App, type AppContext,
  signals, route, readSignals, sse,
  bind, on, text, attr, expr, not,
} from '@bicycle/datastar'
import datastarPath from '@bicycle/datastar/client' with { type: 'file' }

const hello = signals({
  name: z.string().default(''),
  greeting: z.string().default(''),
})

const routes = {
  greet: route('post', '/api/greet'),
}

const Page = () => {
  const $ = hello.$
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Hello Datastar</title>
        <script type="module" src="/static/datastar.js" />
      </head>
      <body {...hello.seed({ name: '', greeting: '' })}>
        <h1>Hello</h1>
        <p {...text(expr`${$.name} ? 'Typing as ' + ${$.name} + '…' : 'Type your name'`)} />
        <input type="text" placeholder="your name" {...bind($.name)} />
        <button
          type="button"
          {...on('click', routes.greet.action())}
          {...attr('disabled', not($.name))}
        >
          Greet me
        </button>
        <h2 id="greeting" {...text($.greeting)} />
      </body>
    </html>
  )
}

const app = new Hono<{ Variables: App }>()

app.use('*', readSignals)

app.get('/static/datastar.js', () =>
  new Response(Bun.file(datastarPath), {
    headers: { 'content-type': 'application/javascript; charset=utf-8' },
  }))

app.get('/', (c) => c.html(<Page />))

app[routes.greet.method](routes.greet.path, (c: AppContext) => {
  const { name } = hello.read(c)
  return sse((stream) => {
    stream.signals(hello.patch({ greeting: `Hello, ${name}!` }))
  })
})

Bun.serve({ port: Number(Bun.env.PORT ?? 8081), fetch: app.fetch })
