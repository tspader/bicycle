import { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { CATEGORIES, Layout, Preview, Warnings } from './views/layout'
import type { Child } from 'hono/jsx'
import { codeToHtml } from 'shiki'
import { project, DEFAULT_MIRROR_URL } from './config'
import { buildInstallSteps } from './install-steps'
import { existsSync } from 'node:fs'
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
import { PRESETS, PartitionFlag, FsType, presetDisk, liveMachine, preflight, deriveWarnings, targetDevice, type Warning, type PresetId, type AccountSummary } from './config'
import { InstallView, ProgressCard } from './views/install'
import { ImportView } from './views/import'
import { spawn as runtimeSpawn, env as runtimeEnv } from './runtime'
import {
  getText, getConfig, getFiles, getIdentity, getRootHash, getEncryptionPassword, getPendingSecrets,
  editScalar, editNode, editDelete, editAppend, editPrune,
  setIdentity, setRootHash, setEncryptionPassword, setFile, deleteFile, stageSecret, unstageSecret,
} from './state'
import { Signal as Signals, SignalProvider, SignalName, defaultSignals } from './signal'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { hashPassword } from './auth'
import { recipientFor, generate as generateAgeIdentity } from './age'
import { EncryptionKind, type BicycleConfig } from '@bicycle/shared'
import { userPasswordAddr, userPasswordRef, secretRelPath } from './secrets'
import api, { Api } from './api'
import { sigSlug } from './slug'
import appCssPath from "./assets/app.css" with { type: "file" }
import datastarPath from "./assets/datastar.js" with { type: "file" }
import faviconPath from "./assets/favicon.ico" with { type: "file" }

export type App = {
  signals: Signals
  error: string | null
  datastar: boolean
}

type AppContext = Context<{ Variables: App }>

const machine = liveMachine()

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

// Parse the bicycle.yml text into the resolved Bicycle config and its throwaway
// archinstall projection. Either parse or projection can fail on a config the
// user is mid-edit (e.g. inconsistent encryption) — callers surface `error`.
type ConfigState = {
  bike: BicycleConfig
  archinstall: ReturnType<typeof project> | null
  error: string | null
}
const configState = (): ConfigState => {
  let bike: BicycleConfig
  try {
    bike = getConfig()
  } catch (e) {
    return { bike: {}, archinstall: null, error: (e as Error).message }
  }
  try {
    return { bike, archinstall: project(bike, machine), error: null }
  } catch (e) {
    return { bike, archinstall: null, error: (e as Error).message }
  }
}

const accounts = (bike: BicycleConfig): AccountSummary[] =>
  (bike.users ?? []).map((u) => ({ sudo: u.sudo, hasPassword: !!u.password }))

const preflightCtx = (bike: BicycleConfig) => ({
  identity: getIdentity(),
  rootSet: !!getRootHash(),
  encryptionSet: !!getEncryptionPassword(),
  accounts: accounts(bike),
})

const flatPackages = (bike: BicycleConfig): string[] =>
  Object.values(bike.packages ?? {}).flat()

const renderPreviewHtml = async (): Promise<string> => {
  const text = getText().trim() || '# empty config'
  try {
    return await codeToHtml(text, { lang: 'yaml', theme: 'github-dark-default' })
  } catch (e) {
    return codeToHtml(`# preview unavailable\n# ${(e as Error).message}`, { lang: 'yaml', theme: 'github-dark-default' })
  }
}

const renderSidecar = async () => {
  const [previewHtml, disks] = await Promise.all([renderPreviewHtml(), listDisks()])
  const { bike, archinstall, error } = configState()
  const warnings: Warning[] = archinstall
    ? deriveWarnings(archinstall, disks, preflightCtx(bike))
    : [{ severity: 'error', message: `Config error: ${error}`, category: 'import' }]
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
  const { bike } = configState()
  switch (cat) {
    case 'system': {
      const [kb, locs, zones] = await Promise.all([kbLayouts(), locales(), timezones()])
      const lc = bike.locale ?? { keyboard: 'us', language: 'en_US.UTF-8', encoding: 'UTF-8' }
      return (
        <SystemView
          hostname={bike.core?.hostname ?? ''}
          locale={{
            state: { kb_layout: lc.keyboard, sys_lang: lc.language, sys_enc: lc.encoding },
            kbLayouts: kb,
            languages: languages(locs), encodings: encodings(locs),
          }}
          time={{ zone: bike.core?.timezone ?? 'UTC', zones, ntp: bike.core?.ntp ?? true }}
          network={{ mode: bike.network?.mode === 'networkmanager' ? 'nm' : 'iso' }}
        />
      )
    }
    case 'users':
      return <UsersView rootSet={getRootHash() != null} users={bike.users ?? []} />
    case 'disk': {
      const sw = bike.swap ?? { enabled: true, algorithm: 'zstd' as const }
      const disks = await listDisks()
      const bikeDisks = bike.disks ?? []
      const open = getOpenDisk()
      const validOpen = open && disks.some((d) => d.path === open) ? open : null
      if (open !== validOpen) setOpenDisk(validOpen)
      const anyEncrypted = bikeDisks.some((d) => d.partitions.some((p) => p.encrypt))
      return (
        <DiskView
          disks={disks}
          bikeDisks={bikeDisks}
          openDisk={validOpen}
          error={getDiskError()}
          anyEncrypted={anyEncrypted}
          encryption={{
            type: bike.encryption?.type ?? 'luks',
            password: !!getEncryptionPassword(),
          }}
          swap={sw}
        />
      )
    }
    case 'pacman': {
      const q = getSignal(c, 'q')
      const reposSig = getSignal(c, 'repos')
      const installed = flatPackages(bike)
      const selected = bike.pacman?.mirrors?.regions ?? []
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
      const b = bike.boot ?? { loader: 'systemd-boot' as const, uki: true, removable: false }
      return (
        <BootView
          kernel={bike.core?.kernels?.[0] ?? 'linux'}
          bootloader={{ loader: b.loader, uki: b.uki, removable: b.removable }}
        />
      )
    }
    case 'import':
      return <ImportView ageKeySet={getIdentity() != null} />
  }
}

app.get('/config/:category', async (c) => {
  const parsed = CategoryParam.safeParse(c.req.param('category'))
  if (!parsed.success) return c.redirect('/config/system')
  return renderPage(c, parsed.data, await buildPage(parsed.data, c))
})

// --- Simple field edits ------------------------------------------------------

const editRoute = <T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  apply: (data: z.infer<T>) => void,
) =>
  app.post(path, (c) => {
    apply(parseSignals(c, schema))
    return patchPreview()
  })

const LocaleSignals = z.object({
  kbLayout: z.string().min(1),
  sysLang: z.string().min(1),
  sysEnc: z.string().min(1),
})
const BootloaderSignals = z.object({
  loader: z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind']),
  uki: z.boolean(),
  removable: z.boolean(),
})

editRoute('/api/hostname', Api.Hostname, (d) => editScalar(['core', 'hostname'], d.hostname))
editRoute('/api/timezone', Api.Timezone, (d) => editScalar(['core', 'timezone'], d.timezone))
editRoute('/api/ntp', Api.Ntp, (d) => editScalar(['core', 'ntp'], d.ntp))
editRoute('/api/kernels', Api.Kernel, (d) => editNode(['core', 'kernels'], [d.kernel]))
editRoute('/api/swap', Api.Swap, (d) => editNode(['swap'], { enabled: d.enabled, algorithm: d.algorithm }))
editRoute('/api/network', Api.Network, (d) =>
  editScalar(['network', 'mode'], d.mode === 'nm' ? 'networkmanager' : 'iso'))
editRoute('/api/locale', LocaleSignals, (d) =>
  editNode(['locale'], { keyboard: d.kbLayout, language: d.sysLang, encoding: d.sysEnc }))
editRoute('/api/bootloader', BootloaderSignals, (d) =>
  editNode(['boot'], { loader: d.loader, uki: d.uki, removable: d.removable }))

// --- Import ------------------------------------------------------------------

app.route('/', api.clone({ machine, patchSidecarInto }))
app.post('/api/secrets/age-key', api.secrets.setKey)
app.post('/api/secrets/age-key/clear', api.secrets.clearKey)

// --- Mirrors -----------------------------------------------------------------

app.post('/api/mirrors/toggle', (c) => {
  const name = requiredQuery(c, 'name')
  const current = getConfig().pacman?.mirrors?.regions ?? []
  const idx = current.indexOf(name)
  if (idx >= 0) {
    editDelete(['pacman', 'mirrors', 'regions', idx])
    editPrune(['pacman', 'mirrors', 'regions'])
    editPrune(['pacman', 'mirrors'])
    editPrune(['pacman'])
  } else {
    editAppend(['pacman', 'mirrors', 'regions'], name)
  }
  const isChecked = idx < 0
  return ServerSentEventGenerator.stream(async (stream) => {
    stream.patchElements((<RegionRowFragment name={name} isChecked={isChecked} />).toString())
    await patchSidecarInto(stream)
  })
})

app.get('/api/mirrors/list', (c) => {
  const needle = getSignal(c, 'q').trim().toLowerCase()
  const all = regions()
  const filtered = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all
  const checked = new Set(getConfig().pacman?.mirrors?.regions ?? [])
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<RegionListFragment items={filtered} checked={checked} />).toString())
  })
})

// --- Packages ----------------------------------------------------------------

app.post('/api/packages/toggle', async (c) => {
  const name = requiredQuery(c, 'name')
  const pkgs = getConfig().packages ?? {}
  let group: string | null = null
  let gIdx = -1
  for (const [repo, list] of Object.entries(pkgs)) {
    const i = list.indexOf(name)
    if (i >= 0) { group = repo; gIdx = i; break }
  }
  if (group) {
    editDelete(['packages', group, gIdx])
    editPrune(['packages', group])
    editPrune(['packages'])
  } else {
    const all = await loadPackages()
    const repo = all.find((p) => p.name === name)?.repo ?? 'extra'
    editAppend(['packages', repo], name)
  }

  const all = await loadPackages()
  const entry = all.find((p) => p.name === name)
  const isChecked = !group
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
  const installed = flatPackages(getConfig())
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
  const checked = new Set(flatPackages(getConfig()))
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

// --- Users -------------------------------------------------------------------

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'user'
const parseGroups = (g: string): string[] => g.split(/[, ]+/).map((x) => x.trim()).filter(Boolean)

const reloadUsers = (c: AppContext) => {
  const body = <UsersView rootSet={getRootHash() != null} users={getConfig().users ?? []} />
  return renderPage(c, 'users', body, '/config/users')
}

app.post('/api/users/root', async (c) => {
  const { root_password } = parseSignals(c, Api.RootPassword)
  if (root_password) setRootHash(await hashPassword(root_password))
  return reloadUsers(c)
})

// Move a user's password secret (staged cleartext and/or imported .age file)
// from one address to another so a rename keeps the ref + secret aligned.
const migrateUserSecret = (oldName: string, newName: string): void => {
  const oldAddr = userPasswordAddr(oldName)
  const newAddr = userPasswordAddr(newName)
  const staged = getPendingSecrets().get(oldAddr)
  if (staged !== undefined) {
    stageSecret(newAddr, staged)
    unstageSecret(oldAddr)
  }
  const file = getFiles().get(secretRelPath(oldAddr))
  if (file) {
    setFile(secretRelPath(newAddr), file)
    deleteFile(secretRelPath(oldAddr))
  }
}

app.post('/api/users/save', (c) => {
  const original = requiredQuery(c, 'original')
  const fields = parseSignals(c, Api.UserFields(slug(original), 'update'))
  const users = getConfig().users ?? []
  const idx = users.findIndex((u) => u.name === original)
  if (idx < 0) return c.text('user not found', 404)
  editScalar(['users', idx, 'name'], fields.username)
  editScalar(['users', idx, 'sudo'], fields.sudo ? 'password' : 'none')
  editNode(['users', idx, 'groups'], parseGroups(fields.groups))
  // On rename, realign an existing password ref + its secret to the new name.
  if (fields.username !== original && users[idx]!.password) {
    migrateUserSecret(original, fields.username)
    editScalar(['users', idx, 'password'], userPasswordRef(fields.username))
  }
  // A typed password (re)stages the secret under the current name; a blank
  // field leaves the existing ref/secret untouched.
  if (fields.password) {
    editScalar(['users', idx, 'password'], userPasswordRef(fields.username))
    stageSecret(userPasswordAddr(fields.username), fields.password)
  }
  return reloadUsers(c)
})

app.post('/api/users/create', (c) => {
  const fields = parseSignals(c, Api.UserFields('new', 'create'))
  const users = getConfig().users ?? []
  if (users.some((u) => u.name === fields.username)) {
    return c.text('username already exists', 400)
  }
  editAppend(['users'], {
    name: fields.username,
    sudo: fields.sudo ? 'password' : 'none',
    groups: parseGroups(fields.groups),
    password: userPasswordRef(fields.username),
  })
  stageSecret(userPasswordAddr(fields.username), fields.password)
  return reloadUsers(c)
})

app.post('/api/users/delete', (c) => {
  const name = requiredQuery(c, 'name')
  const users = getConfig().users ?? []
  const idx = users.findIndex((u) => u.name === name)
  if (idx < 0) return c.text('user not found', 404)
  editDelete(['users', idx])
  editPrune(['users'])
  unstageSecret(userPasswordAddr(name))
  try { deleteFile(secretRelPath(userPasswordAddr(name))) } catch { /* ignore */ }
  return reloadUsers(c)
})

// --- Disk --------------------------------------------------------------------

const reloadDisk = (c: AppContext) =>
  buildPage('disk', c).then((body) => renderPage(c, 'disk', body, '/config/disk'))

// Run a partition-table mutation; on Error, stash the message for the next
// render so the UI shows it inline instead of returning 4xx/5xx.
const tryDiskMutation = (fn: () => void): void => {
  try {
    fn()
    setDiskError(null)
  } catch (e) {
    setDiskError((e as Error).message)
  }
}

// Keep the top-level `encryption:` block in sync with whether any partition is
// marked encrypt: true — the projection rejects a mismatch in either direction.
const reconcileEncryption = (): void => {
  let bike: BicycleConfig
  try { bike = getConfig() } catch { return }
  const anyEnc = (bike.disks ?? []).some((d) => d.partitions.some((p) => p.encrypt))
  const hasBlock = bike.encryption != null
  if (anyEnc && !hasBlock) editNode(['encryption'], { type: 'luks' })
  else if (!anyEnc && hasBlock) editDelete(['encryption'])
}

app.post('/api/disk/open', (c) => {
  setOpenDisk(c.req.query('device') ?? null)
  setDiskError(null)
  return reloadDisk(c)
})

app.post('/api/disk/preset', (c) => {
  const device = requiredQuery(c, 'device')
  const id = requiredQuery(c, 'id') as PresetId
  if (!(id in PRESETS)) throw new HTTPException(400, { message: `unknown preset: ${id}` })
  tryDiskMutation(() => {
    editNode(['disks'], [presetDisk(id, device)])
    reconcileEncryption()
  })
  return reloadDisk(c)
})

app.post('/api/disk/partition/add', (c) => {
  const device = requiredQuery(c, 'device')
  tryDiskMutation(() => {
    const disks = getConfig().disks ?? []
    const di = disks.findIndex((d) => d.device === device)
    const newPart = { fs: 'ext4', size: '1GiB' }
    if (di < 0) {
      editAppend(['disks'], { device, wipe: true, table: 'gpt', partitions: [newPart] })
    } else {
      const parts = disks[di]!.partitions
      // Keep a trailing "rest" partition last so the projection stays valid.
      const insertAt = parts.length > 0 && parts[parts.length - 1]!.size === 'rest'
        ? parts.length - 1
        : parts.length
      const next: unknown[] = [...parts]
      next.splice(insertAt, 0, newPart)
      editNode(['disks', di, 'partitions'], next)
    }
    reconcileEncryption()
  })
  return reloadDisk(c)
})

app.post('/api/disk/partition/delete', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  tryDiskMutation(() => {
    const disks = getConfig().disks ?? []
    const di = disks.findIndex((d) => d.device === device)
    if (di < 0) throw new Error(`device not selected: ${device}`)
    const next: unknown[] = [...disks[di]!.partitions]
    next.splice(idx, 1)
    if (next.length === 0) {
      editDelete(['disks', di])
      editPrune(['disks'])
    } else {
      editNode(['disks', di, 'partitions'], next)
    }
    reconcileEncryption()
  })
  return reloadDisk(c)
})

const PartitionSave = z.object({
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
  const f = parsed.data
  tryDiskMutation(() => {
    const disks = getConfig().disks ?? []
    const di = disks.findIndex((d) => d.device === device)
    if (di < 0) throw new Error(`device not selected: ${device}`)
    const prev = disks[di]!.partitions[idx]
    if (!prev) throw new Error('partition not found')
    const mountOptions = f.mount_options.split(',').map((s) => s.trim()).filter(Boolean)
    const part = {
      mount: f.mount.trim() || undefined,
      fs: f.fs,
      size: f.size,
      // Only the first partition exposes a start field in the UI; non-first
      // partitions keep whatever start they had (usually none — derived by the
      // projection) rather than losing it on an unrelated field edit.
      start: idx === 0 ? (f.start?.trim() || undefined) : prev.start,
      flags: flags.length > 0 ? flags : undefined,
      mount_options: mountOptions.length > 0 ? mountOptions : undefined,
      subvolumes: f.fs === 'btrfs' && prev.subvolumes && prev.subvolumes.length > 0 ? prev.subvolumes : undefined,
      encrypt: f.encrypt ? true : undefined,
    }
    editNode(['disks', di, 'partitions', idx], part)
    reconcileEncryption()
  })
  return reloadDisk(c)
})

const subvolPath = (device: string, idx: number) => {
  const disks = getConfig().disks ?? []
  const di = disks.findIndex((d) => d.device === device)
  if (di < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
  // Guard against a stale request whose partition index no longer exists — an
  // out-of-bounds setIn would otherwise pad the seq with nulls and create a
  // malformed phantom partition.
  if (idx < 0 || idx >= disks[di]!.partitions.length) {
    throw new HTTPException(400, { message: `partition ${idx} not found on ${device}` })
  }
  return ['disks', di, 'partitions', idx, 'subvolumes'] as const
}

const currentSubvols = (device: string, idx: number): { name: string; mount?: string }[] => {
  const disk = (getConfig().disks ?? []).find((d) => d.device === device)
  return (disk?.partitions[idx]?.subvolumes ?? []).map((s) => ({ name: s.name, mount: s.mount }))
}

const writeSubvols = (device: string, idx: number, next: { name: string; mount?: string }[]) => {
  const path = subvolPath(device, idx)
  if (next.length === 0) editDelete([...path])
  else editNode([...path], next)
}

app.post('/api/disk/partition/subvol/add', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  writeSubvols(device, idx, [...currentSubvols(device, idx), { name: '@new' }])
  return reloadDisk(c)
})

app.post('/api/disk/partition/subvol/delete', (c) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const subIdx = Number(requiredQuery(c, 'subIdx'))
  writeSubvols(device, idx, currentSubvols(device, idx).filter((_x, i) => i !== subIdx))
  return reloadDisk(c)
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
  writeSubvols(device, idx, currentSubvols(device, idx).map((sv, i) =>
    i === subIdx ? { name, mount: mount || undefined } : sv,
  ))
  return reloadDisk(c)
})

app.post('/api/disk/encryption-type', (c) => {
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const parsed = EncryptionKind.safeParse(raw.enc_type)
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid encryption type' })
  if (getConfig().encryption) editScalar(['encryption', 'type'], parsed.data)
  return reloadDisk(c)
})

app.post('/api/disk/encryption-password', (c) => {
  const raw = (c.get('signals') ?? {}) as Record<string, unknown>
  const pw = String(raw.enc_password ?? '')
  if (pw) setEncryptionPassword(pw)
  return reloadDisk(c)
})

app.get('/api/config.json', (c) => {
  const { archinstall, error } = configState()
  if (!archinstall) throw new HTTPException(400, { message: error ?? 'invalid config' })
  return c.json(archinstall)
})

import { serve } from './runtime'

// --- Install -----------------------------------------------------------------

const isWet = (): boolean => existsSync('/run/archiso/bootmnt')

// archinstall is handed the projected config (no users — the daemon creates
// them) plus a creds file. root/LUKS passwords aren't part of bicycle.yml; they
// live in transient installer state and are carved out here.
const archinstallFiles = (cfg: NonNullable<ConfigState['archinstall']>) => {
  const creds: Record<string, unknown> = {}
  const root = getRootHash()
  const enc = getEncryptionPassword()
  if (root) creds.root_enc_password = root
  if (enc) creds.encryption_password = enc
  return { config: cfg, creds }
}

const renderInstall = async (c: AppContext) => {
  const { bike, archinstall, error } = configState()
  const disks = await listDisks()
  const pf = archinstall
    ? preflight(archinstall, disks, preflightCtx(bike))
    : { ok: false as const, problems: [error ?? 'invalid config'] }
  const view = (
    <InstallView
      preflight={pf}
      device={archinstall ? targetDevice(archinstall) : null}
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

app.get('/api/install/status', async (c) => renderInstall(c))

app.post('/api/install/start', async (c) => {
  const inst = getInstall()
  if (inst.status === 'running') {
    throw new HTTPException(409, { message: 'install already running' })
  }
  const { bike, archinstall, error } = configState()
  if (!archinstall) throw new HTTPException(400, { message: error ?? 'invalid config' })
  const device = targetDevice(archinstall)
  if (!device) throw new HTTPException(400, { message: 'no target device' })

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
  setInstall({
    status: 'running', mode, device, log: '',
    exitCode: null, startedAt: Date.now(), finishedAt: null,
  })

  try {
    const disks = await listDisks()
    const pf = preflight(archinstall, disks, preflightCtx(bike))
    if (!pf.ok) {
      setInstall({ status: 'idle', startedAt: null })
      throw new HTTPException(400, { message: pf.problems.join('; ') })
    }
    const { config, creds } = archinstallFiles(archinstall)
    const configFile = '/tmp/bicycle-config.json'
    const credsFile = '/tmp/bicycle-creds.json'
    await Bun.write(configFile, JSON.stringify(config, null, 2))
    await Bun.write(credsFile, JSON.stringify(creds, null, 2))

    const args = ['archinstall', '--config', configFile, '--creds', credsFile, '--silent', '--script', 'guided']
    if (!wet) args.push('--dry-run')

    void runInstall(args, wet)
  } catch (e) {
    if (e instanceof HTTPException) throw e
    setInstall({ status: 'failure', exitCode: -1, finishedAt: Date.now() })
    appendInstallLog(`start failed: ${(e as Error).message}\n`)
  }

  return renderInstall(c)
})

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

const runStep = async (label: string, args: string[]): Promise<number> => {
  appendInstallLog(`\n$ ${label}\n`)
  let proc
  try {
    proc = runtimeSpawn(args, { stdout: 'pipe', stderr: 'pipe' })
  } catch (e) {
    appendInstallLog(`spawn failed: ${(e as Error).message}\n`)
    return -1
  }
  try {
    await Promise.all([pump(proc.stdout), pump(proc.stderr)])
    return await proc.exited
  } catch (e) {
    appendInstallLog(`pump failed: ${(e as Error).message}\n`)
    return -1
  }
}

const parseRecipients = (text: string): string[] =>
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

const postArchinstall = async (): Promise<number> => {
  const files = new Map(getFiles())
  const pending = [...getPendingSecrets()].map(([addr, clear]) => ({ addr, clear }))

  // Resolve the recipients to encrypt the staged UI secrets to, so they're
  // decryptable by the age.key that lands on the target.
  let identity = getIdentity()
  let recipients: string[] = []
  if (pending.length > 0) {
    const imported = files.get('recipients')
    if (imported) recipients = parseRecipients(new TextDecoder().decode(imported))
    if (recipients.length === 0) {
      // No usable imported recipients — derive from the identity (generating one
      // if needed) and drop any empty/malformed imported file so buildInstallSteps
      // writes the derived recipients instead of shadowing them.
      files.delete('recipients')
      if (!identity) {
        identity = await generateAgeIdentity()
        setIdentity(identity)
        appendInstallLog('\n(note) generated a new age identity to encrypt UI secrets\n')
      }
      recipients = [await recipientFor(identity)]
    }
  }

  if (!identity) {
    appendInstallLog('\n(note) no age identity set; skipping /mnt/etc/bicycle/age.key write\n')
  }

  const steps = buildInstallSteps({
    text: getText(),
    files,
    identity,
    pendingSecrets: pending,
    recipients,
  })
  for (const step of steps) {
    if (step.kind === 'shell') {
      const code = await runStep(step.label, step.argv)
      if (code !== 0) return code
    } else {
      appendInstallLog(`\n$ ${step.label}\n`)
      try {
        await step.run()
      } catch (e) {
        appendInstallLog(`${step.label} failed: ${(e as Error).message}\n`)
        return -1
      }
    }
  }
  return 0
}

const runInstall = async (args: string[], wet: boolean): Promise<void> => {
  const code = await runStep(args.join(' '), args)
  if (code !== 0) {
    setInstall({ status: 'failure', exitCode: code, finishedAt: Date.now() })
    return
  }
  if (wet) {
    const postCode = await postArchinstall()
    if (postCode !== 0) {
      setInstall({ status: 'failure', exitCode: postCode, finishedAt: Date.now() })
      return
    }
  }
  setInstall({ status: 'success', exitCode: 0, finishedAt: Date.now() })
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
    status: 'idle', log: '', exitCode: null, startedAt: null, finishedAt: null,
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
