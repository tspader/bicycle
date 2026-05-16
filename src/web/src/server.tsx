import { Hono } from 'hono'
import { z } from 'zod'
import { CATEGORIES, Layout, Preview, type CategoryId } from './views/layout'
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
import { getCurrentDetail, setCurrentDetail } from './ui-state'
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
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { ArchinstallConfig, LocaleConfig, Kernel } from './config'
import { hashPassword } from './auth'
import appCssPath from "./assets/app.css" with { type: "file" };
import datastarPath from "./assets/datastar.js" with { type: "file" };
import faviconPath from "./assets/favicon.ico" with { type: "file" };

const app = new Hono()


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

const defaultSub = (cat: CategoryId): string =>
  CATEGORIES.find((c) => c.id === cat)?.subs?.[0]?.id ?? ''

const renderPage = async (
  c: { req: { raw: Request }; html: (n: unknown) => Response | Promise<Response> },
  active: CategoryId,
  body: Child,
  hash?: string,
) => {
  const activeSub = hash || defaultSub(active)
  const isDatastar = c.req.raw.headers.get('datastar-request') === 'true'
  if (!isDatastar) {
    const previewHtml = await renderPreviewHtml()
    return c.html(
      <Layout active={active} activeSub={activeSub} previewHtml={previewHtml}>
        {body}
      </Layout>,
    )
  }
  const preview = await previewFragment()
  return ServerSentEventGenerator.stream((stream) => {
    const html = (<main id="page-content" class="content">{body}</main>).toString()
    stream.patchElements(html)
    stream.patchElements(preview)
    stream.patchSignals(JSON.stringify({ activeCat: active, activeSub }))
    if (hash) {
      stream.executeScript(
        `document.getElementById(${JSON.stringify(hash)})?.scrollIntoView({behavior:'smooth'})`,
      )
    }
  })
}

const patchPreview = () =>
  ServerSentEventGenerator.stream(async (stream) => {
    stream.patchElements(await previewFragment())
  })

const buildPage = async (cat: CategoryId, c: { req: { query: (k: string) => string | undefined } }): Promise<Child> => {
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
      const q = c.req.query('q') ?? ''
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
            initialPage: { items: page.items, next: page.next, q },
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
  if (!parsed.success) return c.redirect('/config/system')
  const body = await buildPage(parsed.data, c)
  const hash = c.req.query('h')
  return renderPage(c, parsed.data, body, hash)
})

type Ctx = { req: { raw: Request } }
const readSignals = (c: Ctx) => ServerSentEventGenerator.readSignals(c.req.raw)

app.post('/api/locale', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const Schema = z.object({ kbLayout: z.string().min(1), sysLang: z.string().min(1), sysEnc: z.string().min(1) })
  const parsed = Schema.safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  const lc: z.infer<typeof LocaleConfig> = { kb_layout: parsed.data.kbLayout, sys_lang: parsed.data.sysLang, sys_enc: parsed.data.sysEnc }
  setState({ locale_config: lc })
  return patchPreview()
})

app.post('/api/kernels', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ kernel: Kernel }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ kernels: [parsed.data.kernel] })
  return patchPreview()
})

app.post('/api/hostname', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ hostname: z.string().min(1).max(63) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ hostname: parsed.data.hostname })
  return patchPreview()
})

app.post('/api/ntp', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ ntp: z.boolean() }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ ntp: parsed.data.ntp })
  return patchPreview()
})

app.post('/api/swap', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z
    .object({ enabled: z.boolean(), algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']) })
    .safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ swap: parsed.data })
  return patchPreview()
})

app.post('/api/bootloader', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const LoaderTok = z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind'])
  const parsed = z.object({ loader: LoaderTok, uki: z.boolean(), removable: z.boolean() }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  const map = { 'systemd-boot': 'Systemd-boot', grub: 'Grub', efistub: 'Efistub', limine: 'Limine', refind: 'Refind' } as const
  setState({ bootloader_config: { bootloader: map[parsed.data.loader], uki: parsed.data.uki, removable: parsed.data.removable } })
  return patchPreview()
})

app.post('/api/network', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ mode: z.enum(['iso', 'nm', 'nm_iwd', 'manual']) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ network_config: { type: parsed.data.mode } })
  return patchPreview()
})

app.post('/api/timezone', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ timezone: z.string().min(1) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ timezone: parsed.data.timezone })
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
    const html = (<RegionRowFragment name={name} isChecked={isChecked} />).toString()
    stream.patchElements(html)
    stream.patchElements(await previewFragment())
  })
})

app.get('/api/mirrors/list', async (c) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  const q = (r.success ? String(r.signals['q'] ?? '') : '') || (c.req.query('q') ?? '')
  const needle = q.trim().toLowerCase()
  const all = regions()
  const filtered = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all
  const s = getState()
  const checked = new Set(Object.keys(s.mirror_config?.mirror_regions ?? {}))
  return ServerSentEventGenerator.stream((stream) => {
    const html = (<RegionListFragment items={filtered} checked={checked} />).toString()
    stream.patchElements(html)
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
      const rowHtml = (<PackageRowFragment p={entry} isChecked={isChecked} isSelected={showDetail} />).toString()
      stream.patchElements(rowHtml)
    }
    if (showDetail) {
      const detail = await packageDetail(name)
      const html = (<PackageDetailFragment detail={detail} />).toString()
      stream.patchElements(html)
    }
    stream.patchElements(await previewFragment())
  })
})

app.get('/api/packages/list', async (c) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  const q = (r.success ? String(r.signals['q'] ?? '') : '') || (c.req.query('q') ?? '')
  const after = c.req.query('after') ?? ''
  const mode = c.req.query('mode') ?? 'outer'
  const s = getState()
  const installed = s.packages ?? []
  const checked = new Set(installed)
  const state = { checked, selectedName: getCurrentDetail() }
  const page = await searchPackages({ q, after, selected: checked })
  return ServerSentEventGenerator.stream((stream) => {
    if (mode === 'append') {
      const rows = (<PackageRowsFragment items={page.items} state={state} />).toString()
      const more = (<PackageMore next={page.next} />).toString()
      stream.patchElements(rows, { selector: '#package-list', mode: 'append' as never })
      stream.patchElements(more)
    } else {
      const html = (
        <PackageListFragment page={{ items: page.items, next: page.next, q }} state={state} />
      ).toString()
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
  const html = (<PackageDetailFragment detail={detail} />).toString()
  return ServerSentEventGenerator.stream((stream) => {
    if (prev && prev !== name) {
      const prevEntry = all.find((p) => p.name === prev)
      if (prevEntry) {
        const row = (<PackageRowFragment p={prevEntry} isChecked={checked.has(prev)} isSelected={false} />).toString()
        stream.patchElements(row)
      }
    }
    if (detail) {
      const cur = all.find((p) => p.name === name)
      if (cur) {
        const row = (<PackageRowFragment p={cur} isChecked={checked.has(name)} isSelected={true} />).toString()
        stream.patchElements(row)
      }
    }
    stream.patchElements(html)
  })
})

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'user'
const parseGroups = (g: string): string[] => g.split(/[, ]+/).map((x) => x.trim()).filter(Boolean)
const reload = () =>
  ServerSentEventGenerator.stream(async (stream) => {
    const s = getState()
    const rootSet = s.root_enc_password !== null && s.root_enc_password !== undefined
    const html = (
      <main id="page-content" class="content">
        <UsersView rootSet={rootSet} users={s.users ?? []} />
      </main>
    ).toString()
    stream.patchElements(html)
    stream.patchElements(await previewFragment())
    stream.patchSignals(JSON.stringify({ activeCat: 'users' }))
    stream.executeScript("history.pushState({}, '', '/config/users')")
  })

const UserFields = z.object({
  username: z.string().min(1).max(32),
  sudo: z.boolean(),
  groups: z.string(),
  password: z.string(),
})

const readUserFields = (signals: Record<string, unknown>, prefix: string) =>
  UserFields.safeParse({
    username: signals[`${prefix}_username`],
    sudo: signals[`${prefix}_sudo`],
    groups: signals[`${prefix}_groups`],
    password: signals[`${prefix}_password`],
  })

app.post('/api/users/root', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ root_password: z.string() }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  if (parsed.data.root_password) {
    setState({ root_enc_password: await hashPassword(parsed.data.root_password) })
  }
  return reload()
})

app.post('/api/users/save', async (c) => {
  const original = c.req.query('original')
  if (!original) return c.text('missing original', 400)
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = readUserFields(r.signals as Record<string, unknown>, slug(original))
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)

  const s = getState()
  const prev = (s.users ?? []).find((u) => u.username === original)
  const enc_password = parsed.data.password
    ? await hashPassword(parsed.data.password)
    : prev?.enc_password ?? null
  const next = (s.users ?? []).filter((u) => u.username !== original)
  next.push({
    username: parsed.data.username,
    sudo: parsed.data.sudo,
    groups: parseGroups(parsed.data.groups),
    enc_password,
  })
  setState({ users: next })
  return reload()
})

app.post('/api/users/create', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = readUserFields(r.signals as Record<string, unknown>, 'new')
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  const s = getState()
  if ((s.users ?? []).some((u) => u.username === parsed.data.username)) {
    return c.text('username already exists', 400)
  }
  const enc_password = parsed.data.password ? await hashPassword(parsed.data.password) : null
  setState({
    users: [
      ...(s.users ?? []),
      {
        username: parsed.data.username,
        sudo: parsed.data.sudo,
        groups: parseGroups(parsed.data.groups),
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
