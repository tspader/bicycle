import { Hono } from 'hono'
import { z } from 'zod'
import { CATEGORIES, type CategoryId } from './views/layout'
import { LocaleView } from './views/locale'
import { KernelsView } from './views/kernels'
import { HostnameView } from './views/hostname'
import { NtpView } from './views/ntp'
import { SwapView } from './views/swap'
import { BootloaderView } from './views/bootloader'
import { NetworkView } from './views/network'
import { TimezoneView } from './views/timezone'
import { MirrorsView, RegionListFragment, RegionRowFragment } from './views/mirrors'
import { UsersView, toRows } from './views/users'
import {
  PackagesView,
  PackageList as PackageListFragment,
  PackageRowsFragment,
  PackageRowFragment,
  PackageMore,
  PackageDetailFragment,
} from './views/packages'
import { getCurrentDetail, setCurrentDetail } from './ui-state'
import { loadPackages } from './system'
import { StubView } from './views/stub'
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

const app = new Hono()


app.get("/static/app.css", () =>
  new Response(Bun.file(appCssPath), { headers: { "content-type": "text/css; charset=utf-8" } })
);
app.get("/static/datastar.js", () =>
  new Response(Bun.file(datastarPath), { headers: { "content-type": "application/javascript; charset=utf-8" } })
);

app.get('/', (c) => c.redirect('/config/locale'))
app.get('/favicon.ico', (c) => c.body(null, 204))

const CategoryParam = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]])

app.get('/config/:category', async (c) => {
  const parsed = CategoryParam.safeParse(c.req.param('category'))
  if (!parsed.success) return c.redirect('/config/locale')
  const s = getState()

  switch (parsed.data) {
    case 'locale': {
      const [kb, locs] = await Promise.all([kbLayouts(), locales()])
      const lc = s.locale_config ?? { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' }
      return c.html(<LocaleView state={lc} kbLayouts={kb} languages={languages(locs)} encodings={encodings(locs)} />)
    }
    case 'kernels': {
      return c.html(<KernelsView selected={s.kernels?.[0] ?? 'linux'} />)
    }
    case 'hostname': {
      return c.html(<HostnameView value={s.hostname ?? ''} />)
    }
    case 'ntp': {
      return c.html(<NtpView enabled={s.ntp ?? true} />)
    }
    case 'swap': {
      const sw = s.swap ?? { enabled: true, algorithm: 'zstd' as const }
      return c.html(<SwapView enabled={sw.enabled} algorithm={sw.algorithm} />)
    }
    case 'bootloader': {
      const b = s.bootloader_config ?? { bootloader: 'Systemd-boot' as const, uki: true, removable: false }
      const loaderMap = { 'Systemd-boot': 'systemd-boot', Grub: 'grub', Efistub: 'efistub', Limine: 'limine', Refind: 'refind' } as const
      return c.html(<BootloaderView loader={loaderMap[b.bootloader]} uki={b.uki} removable={b.removable} />)
    }
    case 'network': {
      const t = s.network_config?.type ?? 'iso'
      return c.html(<NetworkView mode={t} />)
    }
    case 'timezone': {
      const zones = await timezones()
      return c.html(<TimezoneView value={s.timezone ?? 'UTC'} zones={zones} />)
    }
    case 'mirrors': {
      const selected = Object.keys(s.mirror_config?.mirror_regions ?? {})
      return c.html(<MirrorsView regions={regions()} selected={selected} />)
    }
    case 'users': {
      const editName = c.req.query('edit')
      const rows = toRows(s.users, s.root_enc_password !== null && s.root_enc_password !== undefined)
      const editing = editName ? rows.find((r) => r.username === editName) ?? null : null
      return c.html(<UsersView rows={rows} editing={editing} />)
    }
    case 'packages': {
      const q = c.req.query('q') ?? ''
      const installed = s.packages ?? []
      const page = await searchPackages({ q, selected: new Set(installed) })
      setCurrentDetail(null)
      return c.html(
        <PackagesView
          installed={installed}
          detail={null}
          selectedName={null}
          initialPage={{ items: page.items, next: page.next, q }}
        />,
      )
    }
    default:
      return c.html(<StubView id={parsed.data} />)
  }
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
  return c.body(null, 204)
})

app.post('/api/kernels', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ kernel: Kernel }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ kernels: [parsed.data.kernel] })
  return c.body(null, 204)
})

app.post('/api/hostname', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ hostname: z.string().min(1).max(63) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ hostname: parsed.data.hostname })
  return c.body(null, 204)
})

app.post('/api/ntp', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ ntp: z.boolean() }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ ntp: parsed.data.ntp })
  return c.body(null, 204)
})

app.post('/api/swap', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z
    .object({ enabled: z.boolean(), algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']) })
    .safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ swap: parsed.data })
  return c.body(null, 204)
})

app.post('/api/bootloader', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const LoaderTok = z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind'])
  const parsed = z.object({ loader: LoaderTok, uki: z.boolean(), removable: z.boolean() }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  const map = { 'systemd-boot': 'Systemd-boot', grub: 'Grub', efistub: 'Efistub', limine: 'Limine', refind: 'Refind' } as const
  setState({ bootloader_config: { bootloader: map[parsed.data.loader], uki: parsed.data.uki, removable: parsed.data.removable } })
  return c.body(null, 204)
})

app.post('/api/network', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ mode: z.enum(['iso', 'nm', 'nm_iwd', 'manual']) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ network_config: { type: parsed.data.mode } })
  return c.body(null, 204)
})

app.post('/api/timezone', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = z.object({ timezone: z.string().min(1) }).safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  setState({ timezone: parsed.data.timezone })
  return c.body(null, 204)
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
  return ServerSentEventGenerator.stream((stream) => {
    const html = (<RegionRowFragment name={name} isChecked={isChecked} />).toString()
    stream.mergeFragments(html)
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
    stream.mergeFragments(html)
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

  if (!entry && !showDetail) return c.body(null, 204)

  return ServerSentEventGenerator.stream(async (stream) => {
    if (entry) {
      const rowHtml = (<PackageRowFragment p={entry} isChecked={isChecked} isSelected={showDetail} />).toString()
      stream.mergeFragments(rowHtml)
    }
    if (showDetail) {
      const detail = await packageDetail(name)
      const html = (<PackageDetailFragment detail={detail} />).toString()
      stream.mergeFragments(html)
    }
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
      stream.mergeFragments(rows, { selector: '#package-list', mergeMode: 'append' as never })
      stream.mergeFragments(more)
    } else {
      const html = (
        <PackageListFragment page={{ items: page.items, next: page.next, q }} state={state} />
      ).toString()
      stream.mergeFragments(`<div id="package-list" class="list">${html}</div>`)
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
        stream.mergeFragments(row)
      }
    }
    if (detail) {
      const cur = all.find((p) => p.name === name)
      if (cur) {
        const row = (<PackageRowFragment p={cur} isChecked={checked.has(name)} isSelected={true} />).toString()
        stream.mergeFragments(row)
      }
    }
    stream.mergeFragments(html)
  })
})

const UserPayload = z.object({
  kind: z.enum(['root', 'user']),
  username: z.string().min(1).max(32),
  sudo: z.boolean(),
  groups: z.string(),
  password: z.string(),
})

app.post('/api/users/save', async (c) => {
  const r = await readSignals(c)
  if (!r.success) return c.text(r.error, 400)
  const parsed = UserPayload.safeParse(r.signals)
  if (!parsed.success) return c.text(parsed.error.issues[0]?.message ?? 'invalid', 400)
  const groups = parsed.data.groups.split(/[, ]+/).map((g) => g.trim()).filter(Boolean)
  const enc_password = parsed.data.password ? await hashPassword(parsed.data.password) : null

  const s = getState()
  if (parsed.data.kind === 'root') {
    if (enc_password) setState({ root_enc_password: enc_password })
  } else {
    const existing = (s.users ?? []).filter((u) => u.username !== parsed.data.username)
    const prev = (s.users ?? []).find((u) => u.username === parsed.data.username)
    existing.push({
      username: parsed.data.username,
      sudo: parsed.data.sudo,
      groups,
      enc_password: enc_password ?? prev?.enc_password ?? null,
    })
    setState({ users: existing })
  }
  return ServerSentEventGenerator.stream((stream) => {
    stream.executeScript("window.location.href = '/config/users'")
  })
})

app.post('/api/users/delete', async (c) => {
  const name = c.req.query('name')
  if (!name) return c.text('missing name', 400)
  const s = getState()
  setState({ users: (s.users ?? []).filter((u) => u.username !== name) })
  return ServerSentEventGenerator.stream((stream) => {
    stream.executeScript("window.location.href = '/config/users'")
  })
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
