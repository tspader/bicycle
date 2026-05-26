import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { CATEGORIES, Layout, Preview, Warnings } from './views/layout'
import type { Child } from 'hono/jsx'
import { codeToHtml } from 'shiki'
import { toToml, DEFAULT_MIRROR_URL, fromToml } from './config'
import { randomUUID } from 'node:crypto'
import { rmSync, readFileSync } from 'node:fs'
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
import {
  getCurrentDetail, setCurrentDetail,
  getOpenDisk, setOpenDisk,
  getDiskError, setDiskError,
  getInstall, setInstall, appendInstallLog,
  type CategoryId,
} from './ui-state'
import {
  kbLayouts, locales, languages, encodings, timezones,
  regions, searchPackages, packageDetail, syncPacman, availableRepos,
  loadPackages, listDisks,
} from './system'
import { PRESETS, PartitionFlag, FsType, EncryptionType, buildPartitions, liveMachine, preflight, deriveWarnings, targetDevice, type PartitionConfig } from './config'
import { InstallView, ProgressCard } from './views/install'
import { ImportView } from './views/import'
import { existsSync } from 'node:fs'
import { spawn as runtimeSpawn, env as runtimeEnv } from './runtime'
import { getState, setState, replaceState } from './state'
import { Signal as Signals, SignalProvider, SignalName, defaultSignals } from './signal'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { ArchinstallConfig } from './config'
import { hashPassword } from './auth'
import { Api } from './api'
import { sigSlug } from './slug'
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

const renderSidecar = async () => {
  const [previewHtml, disks] = await Promise.all([renderPreviewHtml(), listDisks()])
  const warnings = deriveWarnings(getState(), disks)
  return { previewHtml, warnings }
}

const sidecarFragments = async (): Promise<[string, string]> => {
  const { previewHtml, warnings } = await renderSidecar()
  return [
    (<Preview html={previewHtml} />).toString(),
    (<Warnings items={warnings} />).toString(),
  ]
}

const patchSidecarInto = async (
  stream: { patchElements: (s: string) => void },
): Promise<void> => {
  const [preview, warnings] = await sidecarFragments()
  stream.patchElements(preview)
  stream.patchElements(warnings)
}

const patchPreview = () =>
  ServerSentEventGenerator.stream(async (stream) => {
    await patchSidecarInto(stream)
  })

const renderPage = async (c: AppContext, active: CategoryId | 'install', body: Child, pushUrl?: string) => {
  const { previewHtml, warnings } = await renderSidecar()
  if (!c.get('datastar')) {
    return c.html(
      <SignalProvider value={c.get('signals')}>
        <Layout active={active} previewHtml={previewHtml} warnings={warnings}>{body}</Layout>
      </SignalProvider>,
    )
  }
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<Preview html={previewHtml} />).toString())
    stream.patchElements((<Warnings items={warnings} />).toString())
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
      const open = getOpenDisk()
      const validOpen = open && disks.some((d) => d.path === open) ? open : null
      if (open !== validOpen) setOpenDisk(validOpen)
      return (
        <DiskView
          disks={disks}
          selected={selected}
          openDisk={validOpen}
          error={getDiskError()}
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
    case 'import':
      return <ImportView />
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

const ImportGitSignals = z.object({
  import_git_url: z.string().min(1, 'repository URL required'),
  import_git_user: z.string().optional().default(''),
  import_git_pass: z.string().optional().default(''),
})

const ImportTomlBody = z.object({ toml: z.string().min(1) })

const applyImportToml = (text: string): void => {
  const cfg = fromToml(text, liveMachine())
  replaceState(cfg)
}

app.post('/api/import/git', (c) =>
  ServerSentEventGenerator.stream(async (stream) => {
    const announce = (status: string, error: string) =>
      stream.patchSignals(JSON.stringify({ import_status: status, import_error: error }))
    try {
      const sig = ImportGitSignals.parse(c.get('signals') ?? {})
      let url: URL
      try {
        url = new URL(sig.import_git_url.trim())
      } catch {
        throw new Error('invalid URL')
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('only http(s) URLs are supported on the install medium (no SSH keys)')
      }
      if (sig.import_git_user) url.username = encodeURIComponent(sig.import_git_user)
      if (sig.import_git_pass) url.password = encodeURIComponent(sig.import_git_pass)

      const tmp = `/tmp/bicycle-import-${randomUUID()}`
      const safeUrl = sig.import_git_url.trim()
      try {
        const res = Bun.spawnSync(
          ['git', 'clone', '--depth=1', '--single-branch', url.toString(), tmp],
          {
            env: {
              ...runtimeEnv,
              GIT_TERMINAL_PROMPT: '0',
              GIT_ASKPASS: '/bin/true',
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        )
        if (res.exitCode !== 0) {
          const raw = new TextDecoder().decode(res.stderr) || 'git clone failed'
          const sanitized = raw
            .replaceAll(url.toString(), safeUrl)
            .replaceAll(sig.import_git_pass || ' ', '***')
          const tail = sanitized.trim().split('\n').slice(-2).join(' ').slice(0, 400)
          throw new Error(tail || 'git clone failed')
        }
        const tomlPath = `${tmp}/.bicycle/machine.toml`
        if (!existsSync(tomlPath)) {
          throw new Error('.bicycle/machine.toml not found in repository root')
        }
        const text = readFileSync(tomlPath, 'utf8')
        applyImportToml(text)
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }) } catch {}
      }
      announce(`Imported from ${safeUrl}`, '')
      stream.patchSignals(JSON.stringify({ import_git_url: '', import_git_user: '', import_git_pass: '' }))
      await patchSidecarInto(stream)
    } catch (e) {
      announce('', (e as Error).message || 'import failed')
    }
  }),
)

app.post('/api/import/toml', (c) => {
  const parsed = ImportTomlBody.safeParse(c.get('signals') ?? {})
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid body' })
  }
  try {
    applyImportToml(parsed.data.toml)
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message })
  }
  return c.json({ ok: true })
})

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
    await patchSidecarInto(stream)
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
    await patchSidecarInto(stream)
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

app.post('/api/disk/open', (c) => {
  const device = c.req.query('device')
  setOpenDisk(device ?? null)
  setDiskError(null)
  return reloadDisk(c)
})

// Run a partition-table mutation; on Error, stash the message for the next
// render so the UI shows it inline instead of returning 4xx (which Datastar
// would silently swallow) or 5xx (which crashes the request).
const tryDiskMutation = (fn: () => void): boolean => {
  try {
    fn()
    setDiskError(null)
    return true
  } catch (e) {
    setDiskError((e as Error).message)
    return false
  }
}

const ensureDeviceModification = (
  dc: NonNullable<ArchinstallConfig['disk_config']>,
  device: string,
): number => {
  const idx = dc.device_modifications.findIndex((d) => d.device === device)
  if (idx >= 0) return idx
  dc.device_modifications.push({ device, wipe: true, partitions: [] })
  return dc.device_modifications.length - 1
}

app.post('/api/disk/preset', (c) => {
  const device = requiredQuery(c, 'device')
  const id = requiredQuery(c, 'id')
  const preset = PRESETS[id as keyof typeof PRESETS]
  if (!preset) throw new HTTPException(400, { message: `unknown preset: ${id}` })
  tryDiskMutation(() => {
    const s = getState()
    const dc = s.disk_config ? { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] } : defaultDiskConfig()
    const dIdx = ensureDeviceModification(dc, device)
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
  })
  return reloadDisk(c)
})

app.post('/api/disk/partition/add', (c) => {
  const device = requiredQuery(c, 'device')
  tryDiskMutation(() => {
    const s = getState()
    const dc = s.disk_config ? { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] } : defaultDiskConfig()
    const dIdx = ensureDeviceModification(dc, device)
    const existing = dc.device_modifications[dIdx]!.partitions
    const NEW_BYTES = 1024 * 1024 * 1024
    const MIB = 1024 * 1024
    const prevEncrypted = new Set(dc.disk_encryption?.partitions ?? [])
    const presetParts = existing.map((p) => {
      let size: string
      if (p.original_size === 'rest') {
        const remaining = p.size.value - NEW_BYTES
        if (remaining < MIB) throw new Error('no space left to add another partition')
        size = `${Math.floor(remaining / MIB)}MiB`
      } else {
        size = p.original_size ?? `${p.size.value}${p.size.unit}`
      }
      return {
        mount: p.mountpoint ?? '',
        fs: p.fs_type,
        size,
        start: p.original_start,
        flags: p.flags,
        mount_options: p.mount_options,
        subvol: p.btrfs.map((s) => ({ name: s.name, mount: s.mountpoint ?? undefined })),
        encrypt: prevEncrypted.has(p.obj_id),
      }
    })
    presetParts.push({ mount: '/', fs: 'ext4', size: '1GiB', start: undefined, flags: [], mount_options: [], subvol: [], encrypt: false })
    const built = buildPartitions(presetParts, device, machine)
    const newToOldId = new Map<string, string>()
    for (let i = 0; i < existing.length; i++) {
      const oldId = existing[i]!.obj_id
      const newId = built.partitions[i]!.obj_id
      built.partitions[i] = { ...built.partitions[i]!, obj_id: oldId }
      newToOldId.set(newId, oldId)
    }
    dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions: built.partitions }
    const encIds = built.encryptedObjIds.map((id) => newToOldId.get(id) ?? id)
    if (encIds.length > 0) {
      dc.disk_encryption = {
        encryption_type: dc.disk_encryption?.encryption_type ?? 'luks',
        partitions: encIds,
        lvm_volumes: [],
      }
    } else {
      dc.disk_encryption = undefined
    }
    setState({ disk_config: dc })
  })
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
  if (partitions.length === 0) {
    dc.device_modifications.splice(dIdx, 1)
  } else {
    dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions }
  }
  dc.disk_encryption = recomputeEncryption(dc)
  setState({ disk_config: dc.device_modifications.length > 0 ? dc : undefined })
  return reloadDisk(c)
})

const PartitionSave = z.object({
  // Mount may be empty: swap and bare LUKS containers have no mountpoint.
  mount: z.string(),
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
  tryDiskMutation(() => {
    const s = getState()
    if (!s.disk_config) throw new Error('no disks selected')
    const dc = { ...s.disk_config, device_modifications: [...s.disk_config.device_modifications] }
    const dIdx = dc.device_modifications.findIndex((d) => d.device === device)
    if (dIdx < 0) throw new Error(`device not selected: ${device}`)
    const parts = [...dc.device_modifications[dIdx]!.partitions]
    const prev = parts[idx]
    if (!prev) throw new Error('partition not found')

    // Re-resolve this partition by rebuilding the entire device's partitions
    // (so cursor/start/rest math stays correct across siblings).
    const prevEncrypted = new Set(dc.disk_encryption?.partitions ?? [])
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
        encrypt: prevEncrypted.has(p.obj_id),
      }
    })
    const built = buildPartitions(presetParts, device, machine)
    // Preserve existing obj_ids across rebuild so selection + encryption tracking
    // stay stable. buildPartitions always assigns fresh UUIDs; replace them by
    // index (length is preserved by construction).
    const newToOldId = new Map<string, string>()
    for (let i = 0; i < built.partitions.length; i++) {
      const oldId = parts[i]?.obj_id
      if (!oldId) continue
      const newId = built.partitions[i]!.obj_id
      built.partitions[i] = { ...built.partitions[i]!, obj_id: oldId }
      newToOldId.set(newId, oldId)
    }
    dc.device_modifications[dIdx] = { ...dc.device_modifications[dIdx]!, partitions: built.partitions }
    // The form is authoritative for which partitions are encrypted; do not fall
    // back to recomputeEncryption() here, since the prior dc.disk_encryption still
    // contains the obj_id the user just toggled off and would re-add it.
    const encIds = built.encryptedObjIds.map((id) => newToOldId.get(id) ?? id)
    if (encIds.length > 0) {
      dc.disk_encryption = {
        encryption_type: dc.disk_encryption?.encryption_type ?? 'luks',
        partitions: encIds,
        lvm_volumes: [],
      }
    } else {
      dc.disk_encryption = undefined
    }
    setState({ disk_config: dc })
  })
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

import { serve } from './runtime'

// --- Install endpoints ------------------------------------------------------

// Wet mode is gated on running inside the archiso live environment.
// /run/archiso/bootmnt is created by archiso's initramfs and cannot exist on
// an installed host, so a stray invocation on a dev machine is forced to
// --dry-run no matter what env/args are set.
const isWet = (): boolean => existsSync('/run/archiso/bootmnt')

// archinstall splits its input into config + creds. We hold everything in one
// ArchinstallConfig at runtime; these two helpers carve it back out for the
// JSON files that get passed via --config and --creds.
const CRED_KEYS = ['users', 'root_enc_password', 'encryption_password'] as const
const splitForArchinstall = (cfg: ArchinstallConfig) => {
  const config: Record<string, unknown> = {}
  const creds: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if ((CRED_KEYS as readonly string[]).includes(k)) {
      if (v !== undefined && v !== null) creds[k] = v
    } else {
      if (v !== undefined) config[k] = v
    }
  }
  return { config, creds }
}

const renderInstall = async (c: AppContext) => {
  const s = getState()
  const disks = await listDisks()
  const pf = preflight(s, disks)
  const view = (
    <InstallView
      preflight={pf}
      device={targetDevice(s)}
      mode={isWet() ? 'wet' : 'dry-run'}
      install={getInstall()}
    />
  )
  return renderPage(c, 'install', view, '/install')
}

app.get('/install', (c) => renderInstall(c))

app.get('/api/install/tick', (c) => {
  const inst = getInstall()
  const prevStatus = c.req.query('s')
  if (prevStatus && prevStatus !== inst.status) {
    return renderInstall(c)
  }
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<ProgressCard install={inst} />).toString())
  })
})

// Just the inner content for polling — same body the page already shows, but
// patched into #page-content instead of full reload. No pushUrl here, otherwise
// every 1s poll would push another /install entry onto history.
app.get('/api/install/status', async (c) => {
  const s = getState()
  const disks = await listDisks()
  const view = (
    <InstallView
      preflight={preflight(s, disks)}
      device={targetDevice(s)}
      mode={isWet() ? 'wet' : 'dry-run'}
      install={getInstall()}
    />
  )
  return renderPage(c, 'install', view)
})

app.post('/api/install/start', async (c) => {
  // Claim the running slot synchronously BEFORE any await. Without this,
  // two near-simultaneous POSTs both pass the check and both spawn archinstall.
  const inst = getInstall()
  if (inst.status === 'running') {
    throw new HTTPException(409, { message: 'install already running' })
  }
  const s = getState()
  const device = targetDevice(s)
  if (!device) throw new HTTPException(400, { message: 'no target device' })

  // Server-side enforcement of the type-to-confirm gate. The client form
  // also disables the button until this matches, but a hand-crafted POST
  // could skip the UI; reject here too.
  const signals = (c.get('signals') ?? {}) as Record<string, unknown>
  const typed = String(signals.wipe_typed ?? '')
  if (typed !== device) {
    throw new HTTPException(400, { message: `type ${device} to confirm wipe (got ${JSON.stringify(typed)})` })
  }
  if (!signals.confirm_install) {
    throw new HTTPException(400, { message: 'install confirmation required' })
  }

  const wet = isWet()
  const mode = wet ? 'wet' as const : 'dry-run' as const
  // Take the running slot now so a parallel request loses the 409 check above.
  setInstall({
    status: 'running',
    mode,
    device,
    log: '',
    exitCode: null,
    startedAt: Date.now(),
    finishedAt: null,
  })

  try {
    const disks = await listDisks()
    const pf = preflight(s, disks)
    if (!pf.ok) {
      setInstall({ status: 'idle', startedAt: null })
      throw new HTTPException(400, { message: pf.problems.join('; ') })
    }
    const { config, creds } = splitForArchinstall(s)
    const configFile = '/tmp/bicycle-config.json'
    const credsFile = '/tmp/bicycle-creds.json'
    await Bun.write(configFile, JSON.stringify(config, null, 2))
    await Bun.write(credsFile, JSON.stringify(creds, null, 2))

    const args = ['archinstall', '--config', configFile, '--creds', credsFile, '--silent', '--script', 'guided']
    if (!wet) args.push('--dry-run')
    setInstall({ log: `$ ${args.join(' ')}\n` })

    void runInstall(args)
  } catch (e) {
    if (e instanceof HTTPException) throw e
    setInstall({ status: 'failure', exitCode: -1, finishedAt: Date.now() })
    appendInstallLog(`start failed: ${(e as Error).message}\n`)
  }

  return renderInstall(c)
})

const runInstall = async (args: string[]): Promise<void> => {
  let proc
  try {
    proc = runtimeSpawn(args, { stdout: 'pipe', stderr: 'pipe' })
  } catch (e) {
    appendInstallLog(`spawn failed: ${(e as Error).message}\n`)
    setInstall({ status: 'failure', exitCode: -1, finishedAt: Date.now() })
    return
  }
  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return
    const reader = stream.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      appendInstallLog(dec.decode(value, { stream: true }))
    }
  }
  try {
    await Promise.all([pump(proc.stdout), pump(proc.stderr)])
    const code = await proc.exited
    setInstall({
      status: code === 0 ? 'success' : 'failure',
      exitCode: code,
      finishedAt: Date.now(),
    })
  } catch (e) {
    appendInstallLog(`pump failed: ${(e as Error).message}\n`)
    setInstall({ status: 'failure', exitCode: -1, finishedAt: Date.now() })
  }
}

app.post('/api/install/reboot', (c) => {
  if (!isWet()) throw new HTTPException(400, { message: 'reboot disabled in dry-run mode' })
  if (getInstall().status !== 'success') {
    throw new HTTPException(400, { message: 'reboot only after a successful install' })
  }
  runtimeSpawn(['systemctl', 'reboot'], { stdout: 'ignore', stderr: 'ignore' })
  return c.body('')
})

app.post('/api/install/reset', (c) => {
  if (getInstall().status === 'running') {
    throw new HTTPException(409, { message: 'cannot reset while running' })
  }
  setInstall({
    status: 'idle',
    log: '',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
  })
  return renderInstall(c)
})



const start = async () => {
  syncPacman().then((res) => {
    if (!res.ok) console.warn('[pacman -Sy] failed:', res.error)
    else console.log('[pacman -Sy] ok')
  })
  serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })
}

start()
