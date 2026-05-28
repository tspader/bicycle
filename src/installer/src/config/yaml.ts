import {
  loadBicycleDoc,
  LoaderName,
  type BicycleConfig,
  type EncryptionKind,
} from '@bicycle/shared'
import { ArchinstallConfig, Bootloader, EncryptionType } from './schema'
import { Size, DEFAULT_SECTOR, parseSize, sizeBytes } from './size'
import { MachineCtx } from './machine'

const MIB = 1024 ** 2

export const DEFAULT_MIRROR_URL = 'https://geo.mirror.pkgbuild.com/$repo/os/$arch'

const LOADER_TO_ARCHINSTALL: Record<LoaderName, Bootloader> = {
  'systemd-boot': 'Systemd-boot',
  grub: 'Grub',
  efistub: 'Efistub',
  limine: 'Limine',
  refind: 'Refind',
}

const NET_MODE: Record<'iso' | 'networkmanager', 'iso' | 'nm'> = {
  iso: 'iso',
  networkmanager: 'nm',
}

const addBytes = (a: Size, bytes: number): Size => {
  const total = sizeBytes(a) + bytes
  return { unit: 'B', value: total, sector_size: DEFAULT_SECTOR }
}

// Project the validated Bicycle config into the throwaway archinstall shape:
// the lossy transforms (loader-name mapping, "rest"→bytes sizing, UUID
// assignment, encryption wiring, network-mode aliasing) only ever feed
// archinstall and are discarded after install, so their lossiness is harmless.
// Users are intentionally NOT projected — the daemon creates them on the target
// from bicycle.yml after install (see splitForArchinstall).
export const project = (bike: BicycleConfig, ctx: MachineCtx): ArchinstallConfig => {
  const out: ArchinstallConfig = {}

  if (bike.core) {
    out.hostname = bike.core.hostname
    out.timezone = bike.core.timezone
    out.kernels = bike.core.kernels
    out.ntp = bike.core.ntp
  }

  if (bike.locale) {
    out.locale_config = {
      kb_layout: bike.locale.keyboard,
      sys_lang: bike.locale.language,
      sys_enc: bike.locale.encoding,
    }
  }

  if (bike.boot) {
    out.bootloader_config = {
      bootloader: LOADER_TO_ARCHINSTALL[bike.boot.loader],
      uki: bike.boot.uki,
      removable: bike.boot.removable,
    }
  }

  if (bike.disks) {
    const encryptedObjIds: string[] = []
    const device_modifications = bike.disks.map((d) => {
      const last = d.partitions.length - 1
      let cursor: Size | null = null
      return {
        device: d.device,
        wipe: d.wipe,
        partitions: d.partitions.map((p, i) => {
          const label = p.mount ?? `#${i}`
          if (p.fs !== 'btrfs' && p.subvolumes && p.subvolumes.length > 0) {
            throw new Error(`disk ${d.device} partition ${label}: subvolumes requires fs="btrfs"`)
          }
          if (p.size === 'rest' && i !== last) {
            throw new Error(`disk ${d.device} partition ${label}: "rest" is only allowed on the last partition`)
          }
          let start: Size
          if (p.start) {
            start = parseSize(p.start)
          } else if (i === 0) {
            throw new Error(`disk ${d.device}: first partition must specify start`)
          } else if (cursor === null) {
            throw new Error(`disk ${d.device}: cannot derive start`)
          } else {
            start = cursor
          }
          let size: Size
          if (p.size === 'rest') {
            let totalBytes: number | null = null
            try { totalBytes = ctx.diskSize(d.device) } catch { totalBytes = null }
            if (totalBytes === null) {
              size = { unit: 'B', value: MIB, sector_size: DEFAULT_SECTOR }
            } else {
              const usableEnd = d.table === 'gpt' ? totalBytes - MIB : totalBytes
              const restBytes = usableEnd - sizeBytes(start)
              if (restBytes <= 0) {
                size = { unit: 'B', value: totalBytes, sector_size: DEFAULT_SECTOR }
              } else {
                const aligned = restBytes - (restBytes % MIB)
                size = { unit: 'B', value: aligned, sector_size: DEFAULT_SECTOR }
              }
            }
          } else {
            size = parseSize(p.size)
          }
          cursor = addBytes(start, sizeBytes(size))
          const obj_id = ctx.uuid()
          if (p.encrypt) encryptedObjIds.push(obj_id)
          return {
            obj_id,
            status: 'create' as const,
            type: 'primary' as const,
            fs_type: p.fs,
            mountpoint: p.mount ?? null,
            flags: p.flags ?? [],
            start,
            size,
            btrfs: (p.subvolumes ?? []).map((s) => ({ name: s.name, mountpoint: s.mount ?? null })),
            dev_path: null,
            mount_options: p.mount_options ?? [],
          }
        }),
      }
    })

    const wantsEncryption = encryptedObjIds.length > 0
    if (wantsEncryption && !bike.encryption) {
      throw new Error('partitions marked encrypt=true require an `encryption` block')
    }
    if (bike.encryption && !wantsEncryption) {
      throw new Error('`encryption` block requires at least one partition with encrypt=true')
    }

    out.disk_config = {
      config_type: 'manual_partitioning',
      btrfs_options: { snapshot_config: null },
      device_modifications,
      ...(bike.encryption
        ? {
            disk_encryption: {
              encryption_type: bike.encryption.type as EncryptionType,
              partitions: encryptedObjIds,
              lvm_volumes: [],
            },
          }
        : {}),
    }
  } else if (bike.encryption) {
    throw new Error('`encryption` block requires at least one `disks` entry')
  }

  if (bike.swap) out.swap = bike.swap
  if (bike.packages) out.packages = Object.values(bike.packages).flat().sort()
  if (bike.network) out.network_config = { type: NET_MODE[bike.network.mode] }

  if (bike.pacman) {
    if (bike.pacman.color !== undefined || bike.pacman.parallel_downloads !== undefined) {
      out.pacman_config = {
        color: bike.pacman.color ?? true,
        parallel_downloads: bike.pacman.parallel_downloads ?? 0,
      }
    }
    if (bike.pacman.mirrors) {
      const regions: Record<string, string[]> = {}
      for (const r of bike.pacman.mirrors.regions) regions[r] = [DEFAULT_MIRROR_URL]
      out.mirror_config = {
        mirror_regions: regions,
        custom_servers: (bike.pacman.mirrors.custom ?? []).map((url) => ({ url })),
        custom_repositories: [],
        optional_repositories: [],
      }
    }
  }

  return ArchinstallConfig.parse(out)
}

// Parse + validate bicycle.yml text, then project. Throws on malformed configs
// (bad sizes, inconsistent encryption, schema violations).
export const fromYaml = (text: string, ctx: MachineCtx): ArchinstallConfig =>
  project(loadBicycleDoc(text).resolved, ctx)
