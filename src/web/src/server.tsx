import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { CATEGORIES, Layout, Preview } from './views/layout'
import type { Child } from 'hono/jsx'
import { codeToHtml } from 'shiki'
import { toToml } from './config'
import { SystemView } from './views/system'
import { DiskView } from './views/disk'
import { PacmanView } from './views/pacman'
import { BootView } from './views/boot'
import { UsersView } from './views/users'
import { RegionListFragment, RegionRowFragment } from './views/mirrors'
import {
  PackageList as PackageListFragment,
  PackageRowsFragment,
  PackageRowFragment,
  PackageMore,
  PackageDetailFragment,
} from './views/packages'
import { getCurrentDetail, setCurrentDetail, type CategoryId } from './ui-state'
import { loadPackages } from './system'
import { getState, setState } from './state'
import {
  kbLayouts,
  locales,
  languages,
  encodings,
  timezones,
  regions,
  searchPackages,
  packageDetail,
  syncPacman,
  KERNELS,
} from './system'
import { Signal as Signals, SignalProvider, SignalName, defaultSignals } from './signal'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { ArchinstallConfig } from './config'
import { hashPassword } from './auth'
import { Api } from './api'
import appCssPath from "./assets/app.css" with { type: "file" };
import datastarPath from "./assets/datastar.js" with { type: "file" };
import faviconPath from "./assets/favicon.ico" with { type: "file" };

type App = {
  signals: Signals
  error: string | null
  datastar: boolean
}

type AppContext = Context<{ Variables: App }>

const getSignals = (c: AppContext): Signals => c.get('signals')

// const getSignal = ... totally fucks my syntax highlighting
function getSignal<K extends SignalName>(c: AppContext, name: K): typeof defaultSignals[K] {
  const signal = getSignals(c)[name] ?? defaultSignals[name]
  return signal as typeof defaultSignals[K]
}

function parseSignals<T extends z.ZodTypeAny>(c: AppContext, schema: T): z.infer<T> {
  const err = c.get('error')
  if (err) throw new HTTPException(400, { message: err })
  const parsed = schema.safeParse(c.get('signals'))
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid' })
  }
  return parsed.data
}

const app = new Hono<{ Variables: App }>()

app.use('*', async (c, next) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  c.set('signals', r.success ? r.signals : {})
  c.set('error', r.success ? null : r.error)
  c.set('datastar', c.req.raw.headers.get('datastar-request') === 'true')
  await next()
})

app.get("/static/app.css", () =>
  new Response(Bun.file(appCssPath), { headers: { "content-type": "text/css; charset=utf-8" } })
);
app.get("/static/datastar.js", () =>
  new Response(Bun.file(datastarPath), { headers: { "content-type": "application/javascript; charset=utf-8" } })
);

app.get('/', (c) => c.redirect('/config/system'))
app.get('/favicon.ico', () =>
  new Response(Bun.file(faviconPath), { headers: { "content-type": "image/x-icon" } })
)

const CategoryParam = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]])

const LOADER_MAP = { 'Systemd-boot': 'systemd-boot', Grub: 'grub', Efistub: 'efistub', Limine: 'limine', Refind: 'refind' } as const

const renderPreviewHtml = async (): Promise<string> => {
  let toml: string
  try {
    toml = toToml(getState())
  } catch (e) {
    toml = `# preview unavailable\n# ${(e as Error).message}`
  }
  return codeToHtml(toml, { lang: 'toml', theme: 'github-dark-default' })
}

const previewFragment = async (): Promise<string> =>
  (<Preview html={await renderPreviewHtml()} />).toString()

const patchPreview = () =>
  ServerSentEventGenerator.stream(async (stream) => {
    stream.patchElements(await previewFragment())
  })

const renderFull = async (c: AppContext, active: CategoryId, body: Child) => {
  const previewHtml = await renderPreviewHtml()
  return c.html(
    <SignalProvider value={getSignals(c)}>
      <Layout active={active} previewHtml={previewHtml}>
        {body}
      </Layout>
    </SignalProvider>,
  )
}

const renderPatch = (active: CategoryId, body: Child) =>
  ServerSentEventGenerator.stream(async (stream) => {
    const elements = [
      (
        <Preview html={await renderPreviewHtml()} />
      ),
      (
        <main id="page-content" class="content">
          {body}
        </main>
      )
    ]
    for (const element of elements) stream.patchElements(element.toString())

    stream.patchSignals(JSON.stringify({ activeCat: active }))
  })

const buildPage = async (cat: CategoryId, c: AppContext): Promise<Child> => {
  const s = getState()
  switch (cat) {
    case 'system': {
      const [kb, locs, zones] = await Promise.all([kbLayouts(), locales(), timezones()])
      const lc = s.locale_config ?? { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' }
      return (
        <SystemView
          hostname={s.hostname ?? ''}
          locale={{
            state: lc,
            kbLayouts: kb,
            languages: languages(locs),
            encodings: encodings(locs),
          }}
          time={{ zone: s.timezone ?? 'UTC', zones, ntp: s.ntp ?? true }}
          network={{ mode: s.network_config?.type ?? 'iso' }}
        />
      )
    }
    case 'users': {
      const rootSet = s.root_enc_password !== null && s.root_enc_password !== undefined
      return <UsersView rootSet={rootSet} users={s.users ?? []} />
    }
    case 'disk': {
      const sw = s.swap ?? { enabled: true, algorithm: 'zstd' as const }
      return <DiskView swap={sw} />
    }
    case 'pacman': {
      const q = getSignal(c, 'q')
      const installed = s.packages ?? []
      const selected = Object.keys(s.mirror_config?.mirror_regions ?? {})
      const page = await searchPackages({ q, selected: new Set(installed) })
      setCurrentDetail(null)
      return (
        <PacmanView
          mirrors={{ regions: regions(), selected }}
          packages={{
            installed,
            detail: null,
            selectedName: null,
            initialPage: { items: page.items, next: page.next },
          }}
        />
      )
    }
    case 'boot': {
      const b = s.bootloader_config ?? { bootloader: 'Systemd-boot' as const, uki: true, removable: false }
      return (
        <BootView
          kernel={s.kernels?.[0] ?? 'linux'}
          bootloader={{ loader: LOADER_MAP[b.bootloader], uki: b.uki, removable: b.removable }}
        />
      )
    }
  }
}

app.get('/config/:category', async (c) => {
  const parsed = CategoryParam.safeParse(c.req.param('category'))
  if (!parsed.success) {
    return c.redirect('/config/system')
  }

  const body = await buildPage(parsed.data, c)
  return c.get('datastar') ?
    renderPatch(parsed.data, body) :
    renderFull(c, parsed.data, body)
})

app.post('/api/locale', (c) => {
  setState({ locale_config: parseSignals(c, Api.Locale) })
  return patchPreview()
})

app.post('/api/kernels', (c) => {
  setState({ kernels: [parseSignals(c, Api.Kernel).kernel] })
  return patchPreview()
})

app.post('/api/hostname', (c) => {
  setState({ hostname: parseSignals(c, Api.Hostname).hostname })
  return patchPreview()
})

app.post('/api/ntp', (c) => {
  setState({ ntp: parseSignals(c, Api.Ntp).ntp })
  return patchPreview()
})

app.post('/api/swap', (c) => {
  setState({ swap: parseSignals(c, Api.Swap) })
  return patchPreview()
})

app.post('/api/bootloader', (c) => {
  setState({ bootloader_config: parseSignals(c, Api.Bootloader) })
  return patchPreview()
})

app.post('/api/network', (c) => {
  setState({ network_config: { type: parseSignals(c, Api.Network).mode } })
  return patchPreview()
})

app.post('/api/timezone', (c) => {
  setState({ timezone: parseSignals(c, Api.Timezone).timezone })
  return patchPreview()
})

app.post('/api/mirrors/toggle', async (c) => {
  const name = c.req.query('name')
  if (!name) return c.text('missing name', 400)
  const s = getState()
  const current = { ...(s.mirror_config?.mirror_regions ?? {}) }
  if (name in current) delete current[name]
  else current[name] = []
  setState({
    mirror_config: {
      mirror_regions: current,
      custom_servers: s.mirror_config?.custom_servers ?? [],
      custom_repositories: s.mirror_config?.custom_repositories ?? [],
      optional_repositories: s.mirror_config?.optional_repositories ?? [],
    },
  })
  const isChecked = name in current
  return ServerSentEventGenerator.stream(async (stream) => {
    stream.patchElements((<RegionRowFragment name={name} isChecked={isChecked} />).toString())
    stream.patchElements(await previewFragment())
  })
})

app.get('/api/mirrors/list', async (c) => {
  const needle = getSignal(c, 'q').trim().toLowerCase()
  const all = regions()
  const filtered = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all
  const s = getState()
  const checked = new Set(Object.keys(s.mirror_config?.mirror_regions ?? {}))
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<RegionListFragment items={filtered} checked={checked} />).toString())
  })
})

app.post('/api/packages/toggle', async (c) => {
  const name = c.req.query('name')
  if (!name) return c.text('missing name', 400)
  const s = getState()
  const set = new Set(s.packages ?? [])
  if (set.has(name)) set.delete(name)
  else set.add(name)
  setState({ packages: [...set].sort() })

  const all = await loadPackages()
  const entry = all.find((p) => p.name === name)
  const isChecked = set.has(name)
  const showDetail = getCurrentDetail() === name

  if (!entry && !showDetail) return patchPreview()

  return ServerSentEventGenerator.stream(async (stream) => {
    if (entry) {
      stream.patchElements((<PackageRowFragment p={entry} isChecked={isChecked} isSelected={showDetail} />).toString())
    }
    if (showDetail) {
      const detail = await packageDetail(name)
      stream.patchElements((<PackageDetailFragment detail={detail} />).toString())
    }
    stream.patchElements(await previewFragment())
  })
})

app.get('/api/packages/list', async (c) => {
  const after = c.req.query('after') ?? ''
  const mode = c.req.query('mode') ?? 'outer'
  const s = getState()
  const installed = s.packages ?? []
  const checked = new Set(installed)
  const state = { checked, selectedName: getCurrentDetail() }

  const q = getSignal(c, 'q')
  const page = await searchPackages({ q, after, selected: checked })
  return ServerSentEventGenerator.stream((stream) => {
    if (mode === 'append') {
      const rows = (<PackageRowsFragment items={page.items} state={state} />).toString()
      stream.patchElements(rows, { selector: '#package-list', mode: 'append' as never })
      stream.patchElements((<PackageMore next={page.next} />).toString())
    } else {
      const html = (<PackageListFragment page={{ items: page.items, next: page.next }} state={state} />).toString()
      stream.patchElements(`<div id="package-list" class="list">${html}</div>`)
    }
  })
})

app.get('/api/packages/detail', async (c) => {
  const name = c.req.query('name')
  if (!name) return c.text('missing name', 400)
  const prev = getCurrentDetail()
  const detail = await packageDetail(name)
  setCurrentDetail(detail ? name : null)
  const s = getState()
  const checked = new Set(s.packages ?? [])
  const all = await loadPackages()
  return ServerSentEventGenerator.stream((stream) => {
    if (prev && prev !== name) {
      const prevEntry = all.find((p) => p.name === prev)
      if (prevEntry) {
        stream.patchElements((<PackageRowFragment p={prevEntry} isChecked={checked.has(prev)} isSelected={false} />).toString())
      }
    }
    if (detail) {
      const cur = all.find((p) => p.name === name)
      if (cur) {
        stream.patchElements((<PackageRowFragment p={cur} isChecked={checked.has(name)} isSelected={true} />).toString())
      }
    }
    stream.patchElements((<PackageDetailFragment detail={detail} />).toString())
  })
})

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'user'
const parseGroups = (g: string): string[] => g.split(/[, ]+/).map((x) => x.trim()).filter(Boolean)
const reload = () =>
  ServerSentEventGenerator.stream(async (stream) => {
    const s = getState()
    const rootSet = s.root_enc_password !== null && s.root_enc_password !== undefined
    const body = <UsersView rootSet={rootSet} users={s.users ?? []} />
    stream.patchElements((<main id="page-content" class="content">{body}</main>).toString())
    stream.patchElements(await previewFragment())
    stream.patchSignals(JSON.stringify({ activeCat: 'users' }))
    stream.executeScript("history.pushState({}, '', '/config/users')")
  })

app.post('/api/users/root', async (c) => {
  const { root_password } = parseSignals(c, Api.RootPassword)
  if (root_password) {
    setState({ root_enc_password: await hashPassword(root_password) })
  }
  return reload()
})

app.post('/api/users/save', async (c) => {
  const original = c.req.query('original')
  if (!original) return c.text('missing original', 400)
  const fields = parseSignals(c, Api.UserFields(slug(original)))

  const s = getState()
  const prev = (s.users ?? []).find((u) => u.username === original)
  const enc_password = fields.password
    ? await hashPassword(fields.password)
    : prev?.enc_password ?? null
  const next = (s.users ?? []).filter((u) => u.username !== original)
  next.push({
    username: fields.username,
    sudo: fields.sudo,
    groups: parseGroups(fields.groups),
    enc_password,
  })
  setState({ users: next })
  return reload()
})

app.post('/api/users/create', async (c) => {
  const fields = parseSignals(c, Api.UserFields('new'))
  const s = getState()
  if ((s.users ?? []).some((u) => u.username === fields.username)) {
    return c.text('username already exists', 400)
  }
  const enc_password = fields.password ? await hashPassword(fields.password) : null
  setState({
    users: [
      ...(s.users ?? []),
      {
        username: fields.username,
        sudo: fields.sudo,
        groups: parseGroups(fields.groups),
        enc_password,
      },
    ],
  })
  return reload()
})

app.post('/api/users/delete', async (c) => {
  const name = c.req.query('name')
  if (!name) return c.text('missing name', 400)
  const s = getState()
  setState({ users: (s.users ?? []).filter((u) => u.username !== name) })
  return reload()
})

app.get('/api/config.json', (c) => {
  return c.json(ArchinstallConfig.parse(getState()))
})

import { serve, env as runtimeEnv } from './runtime'

const start = async () => {
  syncPacman().then((res) => {
    if (!res.ok) console.warn('[pacman -Sy] failed:', res.error)
    else console.log('[pacman -Sy] ok')
  })
  serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })
}

start()
