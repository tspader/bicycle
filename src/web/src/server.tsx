import { Hono } from 'hono'
import { z } from 'zod'
import { CATEGORIES, type CategoryId } from './views/layout'
import { LocaleView } from './views/locale'
import { KernelsView } from './views/kernels'
import { StubView } from './views/stub'
import { getState, setState } from './state'
import { listKbLayouts, listLocales, listLanguages, listEncodings } from './data'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { LocaleSchema, KernelsSchema } from './schemas'

// @ts-ignore -- text-loader import
import css from './assets/app.css.txt'
// @ts-ignore -- text-loader import
import datastar from './assets/datastar.txt'

const app = new Hono()

app.get('/static/app.css', () =>
  new Response(css as unknown as string, { headers: { 'content-type': 'text/css; charset=utf-8' } }),
)

app.get('/static/datastar.js', () =>
  new Response(datastar as unknown as string, { headers: { 'content-type': 'application/javascript; charset=utf-8' } }),
)

app.get('/', (c) => c.redirect('/config/locale'))

const CategoryParam = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]])

app.get('/config/:category', async (c) => {
  const parsed = CategoryParam.safeParse(c.req.param('category'))
  if (!parsed.success) return c.redirect('/config/locale')

  switch (parsed.data) {
    case 'locale': {
      const [kbLayouts, locales] = await Promise.all([listKbLayouts(), listLocales()])
      const { locale_config } = getState()
      return c.html(
        <LocaleView
          state={locale_config!}
          kbLayouts={kbLayouts}
          languages={listLanguages(locales)}
          encodings={listEncodings(locales)}
        />,
      )
    }
    case 'kernels': {
      const { kernels } = getState()
      return c.html(<KernelsView selected={kernels?.[0] ?? 'linux'} />)
    }
    default:
      return c.html(<StubView id={parsed.data} />)
  }
})

app.post('/api/locale', async (c) => {
  const read = await ServerSentEventGenerator.readSignals(c.req.raw)
  if (!read.success) return c.text(read.error, 400)
  const parsed = LocaleSchema.safeParse(read.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ locale_config: parsed.data })
  return c.body(null, 204)
})

app.post('/api/kernels', async (c) => {
  const read = await ServerSentEventGenerator.readSignals(c.req.raw)
  if (!read.success) return c.text(read.error, 400)
  const parsed = KernelsSchema.safeParse(read.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ kernels: [parsed.data.kernel] })
  return c.body(null, 204)
})

import { serve, env as runtimeEnv } from './runtime'
serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })

