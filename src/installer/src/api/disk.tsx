import type { Child } from 'hono/jsx'
import { HTTPException } from 'hono/http-exception'
import type { BicycleConfig } from '@bicycle/shared'
import { DiskView, FLAG_OPTIONS, partitionSignals, subvolSignals, encryptionSignals } from '../views/disk'
import { listDisks } from '../system'
import { getOpenDisk, setOpenDisk, getDiskError, setDiskError } from '../ui-state'
import {
  getConfig, getEncryptionPassword, setEncryptionPassword,
  editScalar, editNode, editDelete, editAppend, editPrune,
} from '../state'
import { PRESETS, presetDisk, type PresetId } from '../config'
import type { AppContext, Stream } from '@bicycle/datastar'
import { routes } from '../routes'
import { configState, renderPage, editHandler, patchSidecar } from '../render'
import { swapSignals } from '../views/swap'

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

const reloadDisk = async (c: AppContext, extra?: (stream: Stream) => void): Promise<Response> =>
  renderPage(c, 'disk', await diskBody(c), '/config/disk', extra)

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

export const swap = editHandler(swapSignals, (d) =>
  editNode(['swap'], { enabled: d.enabled, algorithm: d.algorithm }))

export const open = (c: AppContext) => {
  setOpenDisk(routes.diskOpen.params(c).device ?? null)
  setDiskError(null)
  return reloadDisk(c)
}

export const preset = (c: AppContext) => {
  const { device, id } = routes.diskPreset.params(c)
  if (!(id in PRESETS)) throw new HTTPException(400, { message: `unknown preset: ${id}` })
  tryDiskMutation(() => {
    editNode(['disks'], [presetDisk(id as PresetId, device)])
    reconcileEncryption()
  })
  return reloadDisk(c)
}

export const partitionAdd = (c: AppContext) => {
  const { device } = routes.partitionAdd.params(c)
  let focusIdx: number | null = null
  tryDiskMutation(() => {
    const disks = getConfig().disks ?? []
    const di = disks.findIndex((d) => d.device === device)
    const newPart = { fs: 'ext4', size: '1GiB' }
    if (di < 0) {
      editAppend(['disks'], { device, wipe: true, table: 'gpt', partitions: [newPart] })
      focusIdx = 0
    } else {
      const parts = disks[di]!.partitions
      // Keep a trailing "rest" partition last: insert just before it.
      const insertAt = parts.length > 0 && parts[parts.length - 1]!.size === 'rest'
        ? parts.length - 1
        : parts.length
      const next: unknown[] = [...parts]
      next.splice(insertAt, 0, newPart)
      editNode(['disks', di, 'partitions'], next)
      focusIdx = insertAt
    }
    reconcileEncryption()
  })
  return reloadDisk(c, (stream) => {
    if (focusIdx != null) {
      stream.script(
        `document.querySelectorAll('.partition-table tr.partition-row')[${focusIdx}]?.querySelector('input')?.focus()`,
      )
    }
  })
}

export const partitionDelete = (c: AppContext) => {
  const { device, idx } = routes.partitionDelete.params(c)
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

export const partitionSave = (c: AppContext) => {
  const { device, idx } = routes.partitionSave.params(c)
  const f = partitionSignals(device, idx).read(c)
  const flags = FLAG_OPTIONS.filter((flag) => f[`flag_${flag}`])
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
      start: idx === 0 ? (f.start.trim() || undefined) : prev.start,
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
  const { device, idx } = routes.subvolAdd.params(c)
  writeSubvols(device, idx, [...currentSubvols(device, idx), { name: '@new' }])
  return reloadDisk(c)
}

export const subvolDelete = (c: AppContext) => {
  const { device, idx, subIdx } = routes.subvolDelete.params(c)
  writeSubvols(device, idx, currentSubvols(device, idx).filter((_x, i) => i !== subIdx))
  return reloadDisk(c)
}

export const subvolSave = (c: AppContext) => {
  const { device, idx, subIdx } = routes.subvolSave.params(c)
  const { name, mount } = subvolSignals(device, idx, subIdx).read(c)
  writeSubvols(device, idx, currentSubvols(device, idx).map((sv, i) =>
    i === subIdx ? { name, mount: mount.trim() || undefined } : sv,
  ))
  return reloadDisk(c)
}

export const encryptionType = (c: AppContext) => {
  const { enc_type } = encryptionSignals.read(c)
  if (getConfig().encryption) editScalar(['encryption', 'type'], enc_type)
  return reloadDisk(c)
}

export const encryptionPassword = (c: AppContext) => {
  const { enc_password } = encryptionSignals.read(c)
  if (enc_password) setEncryptionPassword(enc_password)
  return patchSidecar()
}
