import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { CATEGORIES, Layout, Preview } from './views/layout'
import type { Child } from 'hono/jsx'
import { codeToHtml } from 'shiki'
import { toToml, DEFAULT_MIRROR_URL } from './config'
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
import {
  kbLayouts, locales, languages, encodings, timezones,
  regions, searchPackages, packageDetail, syncPacman, availableRepos,
  loadPackages, listDisks,
} from './system'
import { PRESETS, PartitionFlag, FsType, EncryptionType, buildPartitions, liveMachine, type PartitionConfig } from './config'
import { getState, setState } from './state'
import { Signal as Signals, SignalProvider, SignalName, defaultSignals } from './signal'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { ArchinstallConfig } from './config'
import { hashPassword } from './auth'
import { Api } from './api'
import appCssPath from "./assets/app.css" with { type: "file" }
import datastarPath from "./assets/datastar.js" with { type: "file" }
import faviconPath from "./assets/favicon.ico" with { type: "file" }

type App = {
  signals: Signals
  error: string | null
  datastar: boolean
}

type AppContext = Context<{ Variables: App }>

// const getSignal = ... totally fucks my syntax highlighting
function getSignal<K extends SignalName>(c: AppContext, name: K): typeof defaultSignals[K] {
  const signal = c.get('signals')[name] ?? defaultSignals[name]
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

const requiredQuery = (c: AppContext, key: string): string => {
  const v = c.req.query(key)
  if (!v) throw new HTTPException(400, { message: `missing ${key}` })
  return v
}

const app = new Hono<{ Variables: App }>()

app.use('*', async (c, next) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  c.set('signals', r.success ? r.signals : {})
  c.set('error', r.success ? null : r.error)
  c.set('datastar', c.req.raw.headers.get('datastar-request') === 'true')
  await next()
})

const staticFile = (path: string, type: string) => () =>
  new Response(Bun.file(path), { headers: { 'content-type': type } })

app.get('/static/app.css', staticFile(appCssPath, 'text/css; charset=utf-8'))
app.get('/static/datastar.js', staticFile(datastarPath, 'application/javascript; charset=utf-8'))
app.get('/favicon.ico', staticFile(faviconPath, 'image/x-icon'))

app.get('/', (c) => c.redirect('/config/system'))

const CategoryParam = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]])

const LOADER_MAP = {
  'Systemd-boot': 'systemd-boot', Grub: 'grub', Efistub: 'efistub',
  Limine: 'limine', Refind: 'refind',
} as const

const renderPreviewHtml = async (): Promise<string> => {
  let toml: string
  try {
    const all = await loadPackages()
    const repos = Object.fromEntries(all.map((p) => [p.name, p.repo]))
    toml = toToml(getState(), repos)
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

const renderPage = async (c: AppContext, active: CategoryId, body: Child, pushUrl?: string) => {
  const previewHtml = await renderPreviewHtml()
  if (!c.get('datastar')) {
    return c.html(
      <SignalProvider value={c.get('signals')}>
        <Layout active={active} previewHtml={previewHtml}>{body}</Layout>
      </SignalProvider>,
    )
  }
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<Preview html={previewHtml} />).toString())
    stream.patchElements((<main id="page-content" class="content">{body}</main>).toString())
    stream.patchSignals(JSON.stringify({ activeCat: active }))
    if (pushUrl) stream.executeScript(`history.pushState({}, '', '${pushUrl}')`)
  })
}

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
            state: lc, kbLayouts: kb,
            languages: languages(locs), encodings: encodings(locs),
          }}
          time={{ zone: s.timezone ?? 'UTC', zones, ntp: s.ntp ?? true }}
          network={{ mode: s.network_config?.type ?? 'iso' }}
        />
      )
    }
    case 'users':
      return <UsersView rootSet={s.root_enc_password != null} users={s.users ?? []} />
    case 'disk': {
      const sw = s.swap ?? { enabled: true, algorithm: 'zstd' as const }
      const disks = await listDisks()
      const selected = s.disk_config?.device_modifications ?? []
      const enc = s.disk_config?.disk_encryption
      return (
        <DiskView
          disks={disks}
          selected={selected}
          encryption={{
            type: enc?.encryption_type ?? 'luks',
            password: !!s.encryption_password,
            objIds: new Set(enc?.partitions ?? []),
          }}
          swap={sw}
        />
      )
    }
    case 'pacman': {
      const q = getSignal(c, 'q')
      const reposSig = getSignal(c, 'repos')
      const installed = s.packages ?? []
      const selected = Object.keys(s.mirror_config?.mirror_regions ?? {})
      const allRepos = await availableRepos()
      const repos = reposSig.length === 0 ? allRepos : reposSig
      const page = await searchPackages({ q, repos, selected: new Set(installed) })
      setCurrentDetail(null)
      return (
        <PacmanView
          mirrors={{ regions: regions(), selected }}
          packages={{
            installed, detail: null, selectedName: null,
            initialPage: { items: page.items, next: page.next },
            availableRepos: allRepos, selectedRepos: repos,
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
  return renderPage(c, parsed.data, await buildPage(parsed.data, c))
})

const stateRoute = <T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  apply: (data: z.infer<T>) => Partial<ArchinstallConfig>,
) =>
  app.post(path, (c) => {
    setState(apply(parseSignals(c, schema)))
    return patchPreview()
  })

stateRoute('/api/locale',     Api.Locale,     (d) => ({ locale_config: d }))
stateRoute('/api/kernels',    Api.Kernel,     (d) => ({ kernels: [d.kernel] }))
stateRoute('/api/hostname',   Api.Hostname,   (d) => ({ hostname: d.hostname }))
stateRoute('/api/ntp',        Api.Ntp,        (d) => ({ ntp: d.ntp }))
stateRoute('/api/swap',       Api.Swap,       (d) => ({ swap: d }))
stateRoute('/api/bootloader', Api.Bootloader, (d) => ({ bootloader_config: d }))
stateRoute('/api/network',    Api.Network,    (d) => ({ network_config: { type: d.mode } }))
stateRoute('/api/timezone',   Api.Timezone,   (d) => ({ timezone: d.timezone }))

app.post('/api/mirrors/toggle', (c) => {
  const name = requiredQuery(c, 'name')
  const s = getState()
  const current = { ...(s.mirror_config?.mirror_regions ?? {}) }
  if (name in current) delete current[name]
  else current[name] = [DEFAULT_MIRROR_URL]
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

app.get('/api/mirrors/list', (c) => {
  const needle = getSignal(c, 'q').trim().toLowerCase()
  const all = regions()
  const filtered = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all
  const checked = new Set(Object.keys(getState().mirror_config?.mirror_regions ?? {}))
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<RegionListFragment items={filtered} checked={checked} />).toString())
  })
})

app.post('/api/packages/toggle', async (c) => {
  const name = requiredQuery(c, 'name')
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
      stream.patchElements((<PackageDetailFragment detail={await packageDetail(name)} />).toString())
    }
    stream.patchElements(await previewFragment())
  })
})

app.get('/api/packages/list', async (c) => {
  const after = c.req.query('after') ?? ''
  const mode = c.req.query('mode') ?? 'outer'
  const installed = getState().packages ?? []
  const state = { checked: new Set(installed), selectedName: getCurrentDetail() }
  const page = await searchPackages({
    q: getSignal(c, 'q'),
    repos: getSignal(c, 'repos'),
    after,
    selected: state.checked,
  })
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
  const name = requiredQuery(c, 'name')
  const prev = getCurrentDetail()
  const detail = await packageDetail(name)
  setCurrentDetail(detail ? name : null)
  const checked = new Set(getState().packages ?? [])
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

const reloadUsers = (c: AppContext) => {
  const s = getState()
  const body = <UsersView rootSet={s.root_enc_password != null} users={s.users ?? []} />
  return renderPage(c, 'users', body, '/config/users')
}

app.post('/api/users/root', async (c) => {
  const { root_password } = parseSignals(c, Api.RootPassword)
  if (root_password) setState({ root_enc_password: await hashPassword(root_password) })
  return reloadUsers(c)
})

app.post('/api/users/save', async (c) => {
  const original = requiredQuery(c, 'original')
  const fields = parseSignals(c, Api.UserFields(slug(original), 'update'))
  const s = getState()
  const prev = (s.users ?? []).find((u) => u.username === original)
  if (!prev) return c.text('user not found', 404)
  const enc_password = fields.password
    ? await hashPassword(fields.password)
    : prev.enc_password
  const next = (s.users ?? []).filter((u) => u.username !== original)
  next.push({
    username: fields.username,
    sudo: fields.sudo,
    groups: parseGroups(fields.groups),
    enc_password,
  })
  setState({ users: next })
  return reloadUsers(c)
})

app.post('/api/users/create', async (c) => {
  const fields = parseSignals(c, Api.UserFields('new', 'create'))
  const s = getState()
  if ((s.users ?? []).some((u) => u.username === fields.username)) {
    return c.text('username already exists', 400)
  }
  const enc_password = await hashPassword(fields.password)
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
  return reloadUsers(c)
})

app.post('/api/users/delete', (c) => {
  const name = requiredQuery(c, 'name')
  const s = getState()
  setState({ users: (s.users ?? []).filter((u) => u.username !== name) })
  return reloadUsers(c)
})

// --- Disk endpoints ----------------------------------------------------------

const machine = liveMachine()

const reloadDisk = (c: AppContext) => buildPage('disk', c).then((body) => renderPage(c, 'disk', body, '/config/disk'))

const defaultDiskConfig = (): NonNullable<ArchinstallConfig['disk_config']> => ({
  config_type: 'manual_partitioning',
  device_modifications: [],
  btrfs_options: { snapshot_config: null },
})

const recomputeEncryption = (
  dc: NonNullable<ArchinstallConfig['disk_config']>,
  type: EncryptionType = 'luks',
): NonNullable<ArchinstallConfig['disk_config']>['disk_encryption'] | undefined => {
  const enc: string[] = []
  for (const d of dc.device_modifications) {
    for (const p of d.partitions) {
      // Mark this partition as encrypted iff it was already in the prior set.
      if (dc.disk_encryption?.partitions.includes(p.obj_id)) enc.push(p.obj_id)
    }
  }
  if (enc.length === 0) return undefined
  return {
    encryption_type: dc.disk_encryption?.encryption_type ?? type,
    partitions: enc,
    lvm_volumes: [],
  }
}

const setEncryptedFlag = (
  dc: NonNullable<ArchinstallConfig['disk_config']>,
  device: string,
  idx: number,
  on: boolean,
) => {
  const part = dc.device_modifications.find((d) => d.device === device)?.partitions[idx]
  if (!part) return
  const cur = new Set(dc.disk_encryption?.partitions ?? [])
  if (on) cur.add(part.obj_id)
  else cur.delete(part.obj_id)
  if (cur.size === 0) {
    dc.disk_encryption = undefined
  } else {
    dc.disk_encryption = {
      encryption_type: dc.disk_encryption?.encryption_type ?? 'luks',
      partitions: [...cur],
      lvm_volumes: [],
    }
  }
}

app.post('/api/disk/toggle', (c) => {
  const device = requiredQuery(c, 'device')
  const s = getState()
  const dc = s.disk_config ? { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] } : defaultDiskConfig()
  const idx = dc.device_modifications.findIndex((d) => d.device === device)
  if (idx >= 0) {
    dc.device_modifications.splice(idx, 1)
  } else {
    dc.device_modifications.push({ device, wipe: true, partitions: [] })
  }
  dc.disk_encryption = recomputeEncryption(dc)
  setState({ disk_config: dc.device_modifications.length > 0 ? dc : undefined })
  return reloadDisk(c)
})

app.post('/api/disk/preset', (c) => {
  const device = requiredQuery(c, 'device')
  const id = requiredQuery(c, 'id') as keyof typeof PRESETS
  const preset = PRESETS[id]
  if (!preset) throw new HTTPException(400, { message: `unknown preset: ${id}` })
  const s = getState()
  if (!s.disk_config) throw new HTTPException(400, { message: 'no disks selected' })
  const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
  const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
  if (dIdx < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  const built = buildPartitions(preset.parts, device, machine)
  dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions: built.partitions }
  if (built.encryptedObjIds.length > 0) {
    const existing = new Set(dc.disk_encryption?.partitions ?? [])
    for (const id of built.encryptedObjIds) existing.add(id)
    dc.disk_encryption = {
      encryption_type: dc.disk_encryption?.encryption_type ?? 'luks',
      partitions: [...existing],
      lvm_volumes: [],
    }
  } else {
    dc.disk_encryption = recomputeEncryption(dc)
  }
  setState({ disk_config: dc })
  return reloadDisk(c)
})

app.post('/api/disk/partition/add', (c) => {
  const device = requiredQuery(c, 'device')
  const s = getState()
  if (!s.disk_config) throw new HTTPException(400, { message: 'no disks selected' })
  const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
  const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
  if (dIdx < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  const built = buildPartitions(
    [{ mount: '/', fs: 'ext4', size: '1GiB' }],
    device,
    machine,
  )
  const partitions = [...dc.device_modifications[dIdx]!.partitions, ...built.partitions]
  dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions }
  setState({ disk_config: dc })
  return reloadDisk(c)
})

app.post('/api/disk/partition/delete', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const s = getState()
  if (!s.disk_config) throw new HTTPException(400, { message: 'no disks selected' })
  const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
  const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
  if (dIdx < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  const partitions = [...dc.device_modifications[dIdx]!.partitions]
  partitions.splice(idx, 1)
  dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions }
  dc.disk_encryption = recomputeEncryption(dc)
  setState({ disk_config: dc })
  return reloadDisk(c)
})

const sigSlug = (s: string): string => s.replace(/[^a-z0-9]/gi, '_').replace(/^_+/, '')

const PartitionSave = z.object({
  mount: z.string().min(1),
  fs: FsType,
  size: z.string().min(1),
  start: z.string().optional(),
  mount_options: z.string().optional().default(''),
  encrypt: z.boolean().default(false),
  flags: z.array(PartitionFlag).default([]),
})

app.post('/api/disk/partition/save', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const sl = `${sigSlug(device)}_p${idx}`
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const flags: PartitionFlag[] = []
  for (const f of ['boot', 'esp', 'swap'] as const) {
    if (raw[`${sl}_flag_${f}`]) flags.push(f)
  }
  const parsed = PartitionSave.safeParse({
    mount: raw[`${sl}_mount`],
    fs: raw[`${sl}_fs`],
    size: raw[`${sl}_size`],
    start: raw[`${sl}_start`] || undefined,
    mount_options: raw[`${sl}_mount_options`] ?? '',
    encrypt: !!raw[`${sl}_encrypt`],
    flags,
  })
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid' })
  const fields = parsed.data
  const s = getState()
  if (!s.disk_config) throw new HTTPException(400, { message: 'no disks selected' })
  const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
  const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
  if (dIdx < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  const parts = [...dc.device_modifications[dIdx]!.partitions]
  const prev = parts[idx]
  if (!prev) throw new HTTPException(404, { message: 'partition not found' })

  // Re-resolve this partition by rebuilding the entire device's partitions
  // (so cursor/start/rest math stays correct across siblings).
  const presetParts = parts.map((p, i) => {
    if (i === idx) {
      return {
        mount: fields.mount,
        fs: fields.fs,
        size: fields.size,
        start: fields.start,
        flags: fields.flags,
        mount_options: fields.mount_options.split(',').map((s) => s.trim()).filter(Boolean),
        subvol: prev.btrfs.map((s) => ({ name: s.name, mount: s.mountpoint ?? undefined })),
        encrypt: fields.encrypt,
      }
    }
    return {
      mount: p.mountpoint ?? '',
      fs: p.fs_type,
      size: p.original_size ?? `${p.size.value}${p.size.unit}`,
      start: p.original_start,
      flags: p.flags,
      mount_options: p.mount_options,
      subvol: p.btrfs.map((s) => ({ name: s.name, mount: s.mountpoint ?? undefined })),
      encrypt: dc.disk_encryption?.partitions.includes(p.obj_id) ?? false,
    }
  })
  const built = buildPartitions(presetParts, device, machine)
  dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions: built.partitions }
  if (built.encryptedObjIds.length > 0) {
    dc.disk_encryption = {
      encryption_type: dc.disk_encryption?.encryption_type ?? 'luks',
      partitions: built.encryptedObjIds,
      lvm_volumes: [],
    }
  } else {
    dc.disk_encryption = undefined
  }
  setState({ disk_config: dc })
  return reloadDisk(c)
})

app.post('/api/disk/partition/subvol/add', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  return mutateSubvols(c, device, idx, (subs) => [...subs, { name: '', mountpoint: null }])
})

app.post('/api/disk/partition/subvol/delete', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const subIdx = Number(requiredQuery(c, 'subIdx'))
  return mutateSubvols(c, device, idx, (subs) => subs.filter((_x: unknown, i: number) => i !== subIdx))
})

app.post('/api/disk/partition/subvol/save', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const subIdx = Number(requiredQuery(c, 'subIdx'))
  const sl = `${sigSlug(device)}_p${idx}_sv${subIdx}`
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const name = String(raw[`${sl}_name`] ?? '').trim()
  const mount = String(raw[`${sl}_mount`] ?? '').trim()
  if (!name) throw new HTTPException(400, { message: 'subvolume name required' })
  return mutateSubvols(c, device, idx, (subs) =>
    subs.map((sv, i) => (i === subIdx ? { name, mountpoint: mount || null } : sv)),
  )
})

function mutateSubvols(
  c: AppContext,
  device: string,
  idx: number,
  fn: (subs: PartitionConfig['btrfs']) => PartitionConfig['btrfs'],
) {
  const s = getState()
  if (!s.disk_config) throw new HTTPException(400, { message: 'no disks selected' })
  const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
  const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
  if (dIdx < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  const parts = [...dc.device_modifications[dIdx]!.partitions]
  const prev = parts[idx]
  if (!prev) throw new HTTPException(404, { message: 'partition not found' })
  parts[idx] = { ...prev, btrfs: fn(prev.btrfs) }
  dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions: parts }
  setState({ disk_config: dc })
  return reloadDisk(c)
}

app.post('/api/disk/encryption-type', (c) => {
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const parsed = EncryptionType.safeParse(raw.enc_type)
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid encryption type' })
  const s = getState()
  if (!s.disk_config?.disk_encryption) return reloadDisk(c)
  const dc = { ...s.disk_config, disk_encryption: { ...s.disk_config.disk_encryption, encryption_type: parsed.data } }
  setState({ disk_config: dc })
  return reloadDisk(c)
})

app.post('/api/disk/encryption-password', (c) => {
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const pw = String(raw.enc_password ?? '')
  if (pw) setState({ encryption_password: pw })
  return reloadDisk(c)
})

app.get('/api/config.json', (c) => c.json(ArchinstallConfig.parse(getState())))

import { serve, env as runtimeEnv } from './runtime'

const start = async () => {
  syncPacman().then((res) => {
    if (!res.ok) console.warn('[pacman -Sy] failed:', res.error)
    else console.log('[pacman -Sy] ok')
  })
  serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })
}

start()
