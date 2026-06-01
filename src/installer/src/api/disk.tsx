import type { Child } from 'hono/jsx'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { EncryptionKind, type BicycleConfig } from '@bicycle/shared'
import { DiskView } from '../views/disk'
import { listDisks } from '../system'
import { getOpenDisk, setOpenDisk, getDiskError, setDiskError } from '../ui-state'
import {
  getConfig, getEncryptionPassword, setEncryptionPassword,
  editScalar, editNode, editDelete, editAppend, editPrune,
} from '../state'
import { PRESETS, PartitionFlag, FsType, presetDisk, type PresetId } from '../config'
import { type AppContext, requiredQuery } from '../http'
import { configState, renderPage, editHandler } from '../render'
import { sigSlug } from '../slug'
import { Api } from './types'

const rawSignals = (c: AppContext): Record<string, unknown> =>
  (c.get('signals') ?? {}) as Record<string, unknown>

export const diskBody = async (c: AppContext): Promise<Child> => {
  const { bike } = configState()
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

const reloadDisk = async (c: AppContext): Promise<Response> =>
  renderPage(c, 'disk', await diskBody(c), '/config/disk')

const tryDiskMutation = (fn: () => void): void => {
  try {
    fn()
    setDiskError(null)
  } catch (e) {
    setDiskError((e as Error).message)
  }
}

const reconcileEncryption = (): void => {
  let bike: BicycleConfig
  try { bike = getConfig() } catch { return }
  const anyEnc = (bike.disks ?? []).some((d) => d.partitions.some((p) => p.encrypt))
  const hasBlock = bike.encryption != null
  if (anyEnc && !hasBlock) editNode(['encryption'], { type: 'luks' })
  else if (!anyEnc && hasBlock) editDelete(['encryption'])
}

export const swap = editHandler(Api.Swap, (d) =>
  editNode(['swap'], { enabled: d.enabled, algorithm: d.algorithm }))

export const open = (c: AppContext) => {
  setOpenDisk(c.req.query('device') ?? null)
  setDiskError(null)
  return reloadDisk(c)
}

export const preset = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  const id = requiredQuery(c, 'id') as PresetId
  if (!(id in PRESETS)) throw new HTTPException(400, { message: `unknown preset: ${id}` })
  tryDiskMutation(() => {
    editNode(['disks'], [presetDisk(id, device)])
    reconcileEncryption()
  })
  return reloadDisk(c)
}

export const partitionAdd = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  tryDiskMutation(() => {
    const disks = getConfig().disks ?? []
    const di = disks.findIndex((d) => d.device === device)
    const newPart = { fs: 'ext4', size: '1GiB' }
    if (di < 0) {
      editAppend(['disks'], { device, wipe: true, table: 'gpt', partitions: [newPart] })
    } else {
      const parts = disks[di]!.partitions
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
}

export const partitionDelete = (c: AppContext) => {
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
}

const PartitionSave = z.object({
  mount: z.string(),
  fs: FsType,
  size: z.string().min(1),
  start: z.string().optional(),
  mount_options: z.string().optional().default(''),
  encrypt: z.boolean().default(false),
  flags: z.array(PartitionFlag).default([]),
})

export const partitionSave = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const sl = `${sigSlug(device)}_p${idx}`
  const raw = rawSignals(c)
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
}

const subvolPath = (device: string, idx: number) => {
  const disks = getConfig().disks ?? []
  const di = disks.findIndex((d) => d.device === device)
  if (di < 0) throw new HTTPException(400, { message: `device not selected: ${device}` })
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

export const subvolAdd = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  writeSubvols(device, idx, [...currentSubvols(device, idx), { name: '@new' }])
  return reloadDisk(c)
}

export const subvolDelete = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const subIdx = Number(requiredQuery(c, 'subIdx'))
  writeSubvols(device, idx, currentSubvols(device, idx).filter((_x, i) => i !== subIdx))
  return reloadDisk(c)
}

export const subvolSave = (c: AppContext) => {
  const device = requiredQuery(c, 'device')
  const idx = Number(requiredQuery(c, 'idx'))
  const subIdx = Number(requiredQuery(c, 'subIdx'))
  const sl = `${sigSlug(device)}_p${idx}_sv${subIdx}`
  const raw = rawSignals(c)
  const name = String(raw[`${sl}_name`] ?? '').trim()
  const mount = String(raw[`${sl}_mount`] ?? '').trim()
  if (!name) throw new HTTPException(400, { message: 'subvolume name required' })
  writeSubvols(device, idx, currentSubvols(device, idx).map((sv, i) =>
    i === subIdx ? { name, mount: mount || undefined } : sv,
  ))
  return reloadDisk(c)
}

export const encryptionType = (c: AppContext) => {
  const parsed = EncryptionKind.safeParse(rawSignals(c).enc_type)
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid encryption type' })
  if (getConfig().encryption) editScalar(['encryption', 'type'], parsed.data)
  return reloadDisk(c)
}

export const encryptionPassword = (c: AppContext) => {
  const pw = String(rawSignals(c).enc_password ?? '')
  if (pw) setEncryptionPassword(pw)
  return reloadDisk(c)
}
