import { parse as parseTomlText, stringify as stringifyToml } from 'smol-toml'
import { z } from 'zod'
import { ArchinstallConfig, FsType, PartitionFlag, Kernel, Bootloader, EncryptionType } from './schema'
import { Size, DEFAULT_SECTOR, parseSize, formatSize, sizeBytes } from './size'
import { MachineCtx } from './machine'

const MIB = 1024 ** 2

export const DEFAULT_MIRROR_URL = 'https://geo.mirror.pkgbuild.com/$repo/os/$arch'

const LoaderName = z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind'])
const LOADER_TO_ARCHINSTALL: Record<z.infer<typeof LoaderName>, z.infer<typeof Bootloader>> = {
  'systemd-boot': 'Systemd-boot',
  grub: 'Grub',
  efistub: 'Efistub',
  limine: 'Limine',
  refind: 'Refind',
}
const ARCHINSTALL_TO_LOADER: Record<z.infer<typeof Bootloader>, z.infer<typeof LoaderName>> =
  Object.fromEntries(Object.entries(LOADER_TO_ARCHINSTALL).map(([k, v]) => [v, k])) as never

const BicycleSubvol = z.object({
  name: z.string().min(1),
  mount: z.string().min(1).optional(),
}).strict()

const BicyclePartition = z.object({
  mount: z.string().min(1),
  fs: FsType,
  size: z.string().min(1),
  start: z.string().min(1).optional(),
  flags: z.array(PartitionFlag).optional(),
  mount_options: z.array(z.string().min(1)).optional(),
  subvol: z.array(BicycleSubvol).optional(),
  encrypt: z.boolean().optional(),
}).strict()

const BicycleDisk = z.object({
  device: z.string().min(1),
  wipe: z.boolean(),
  table: z.enum(['gpt', 'mbr']),
  partition: z.array(BicyclePartition).min(1),
}).strict()

const BicycleUser = z.object({
  name: z.string().min(1),
  sudo: z.boolean(),
  groups: z.array(z.string()),
}).strict()

const BicycleToml = z.object({
  core: z
    .object({
      hostname: z.string().min(1),
      timezone: z.string().min(1),
      kernels: z.array(Kernel).min(1),
      ntp: z.boolean(),
    })
    .strict()
    .optional(),
  locale: z
    .object({
      keyboard: z.string().min(1),
      language: z.string().min(1),
      encoding: z.string().min(1),
    })
    .strict()
    .optional(),
  boot: z
    .object({
      loader: LoaderName,
      uki: z.boolean(),
      removable: z.boolean(),
    })
    .strict()
    .optional(),
  disk: z.array(BicycleDisk).optional(),
  swap: z
    .object({
      enabled: z.boolean(),
      algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']),
    })
    .strict()
    .optional(),
  user: z.array(BicycleUser).optional(),
  packages: z.record(z.string(), z.array(z.string())).optional(),
  pacman: z
    .object({
      color: z.boolean().optional(),
      parallel_downloads: z.number().int().nonnegative().optional(),
      mirrors: z
        .object({
          regions: z.array(z.string()).min(1),
          custom: z.array(z.string().url()).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  network: z
    .object({
      mode: z.enum(['iso', 'networkmanager']),
    })
    .strict()
    .optional(),
  encryption: z
    .object({
      type: z.enum(['luks', 'lvm_on_luks', 'luks_on_lvm']),
    })
    .strict()
    .optional(),
}).strict()
export type BicycleToml = z.infer<typeof BicycleToml>

const NET_MODE: Record<z.infer<typeof BicycleToml>['network'] extends infer T ? T extends { mode: infer M } ? M : never : never, 'iso' | 'nm'> = {
  iso: 'iso',
  networkmanager: 'nm',
}

const NET_MODE_REVERSE: Record<'iso' | 'nm', 'iso' | 'networkmanager'> = {
  iso: 'iso',
  nm: 'networkmanager',
}

const addBytes = (a: Size, bytes: number): Size => {
  const total = sizeBytes(a) + bytes
  return { unit: 'B', value: total, sector_size: DEFAULT_SECTOR }
}

export const fromToml = (text: string, ctx: MachineCtx): ArchinstallConfig => {
  const raw = parseTomlText(text)
  const bike = BicycleToml.parse(raw)
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

  if (bike.disk) {
    const encryptedObjIds: string[] = []
    const device_modifications = bike.disk.map((d) => {
      const last = d.partition.length - 1
      let cursor: Size | null = null
      return {
        device: d.device,
        wipe: d.wipe,
        partitions: d.partition.map((p, i) => {
          if (p.fs !== 'btrfs' && p.subvol && p.subvol.length > 0) {
            throw new Error(`disk ${d.device} partition ${p.mount}: subvol requires fs="btrfs"`)
          }
          if (p.size === 'rest' && i !== last) {
            throw new Error(`disk ${d.device} partition ${p.mount}: "rest" is only allowed on the last partition`)
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
            const totalBytes = ctx.diskSize(d.device)
            // Leave 1 MiB at the tail for the GPT backup header, then align down.
            const usableEnd = d.table === 'gpt' ? totalBytes - MIB : totalBytes
            const restBytes = usableEnd - sizeBytes(start)
            if (restBytes <= 0) {
              throw new Error(`disk ${d.device}: no space left for "rest" partition ${p.mount}`)
            }
            const aligned = restBytes - (restBytes % MIB)
            size = { unit: 'B', value: aligned, sector_size: DEFAULT_SECTOR }
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
            mountpoint: p.mount,
            flags: p.flags ?? [],
            start,
            size,
            btrfs: (p.subvol ?? []).map((s) => ({ name: s.name, mountpoint: s.mount ?? null })),
            dev_path: null,
            mount_options: p.mount_options ?? [],
            original_size: p.size,
            ...(p.start ? { original_start: p.start } : {}),
          }
        }),
      }
    })

    const wantsEncryption = encryptedObjIds.length > 0
    if (wantsEncryption && !bike.encryption) {
      throw new Error('partitions marked encrypt=true require an [encryption] block')
    }
    if (bike.encryption && !wantsEncryption) {
      throw new Error('[encryption] block requires at least one partition with encrypt=true')
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
    throw new Error('[encryption] block requires at least one [[disk]]')
  }

  if (bike.swap) out.swap = bike.swap
  if (bike.user) {
    // BicycleToml has no password field; users from TOML can't be applied without a password.
    if (bike.user.length > 0) {
      throw new Error('user accounts in TOML are not supported (passwords cannot be expressed safely in checked-in config)')
    }
  }
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

export const toToml = (cfg: ArchinstallConfig, packageRepos: Record<string, string> = {}): string => {
  const bike: Record<string, unknown> = {}

  if (cfg.hostname || cfg.timezone || cfg.kernels || cfg.ntp !== undefined) {
    const core: Record<string, unknown> = {}
    if (cfg.hostname) core.hostname = cfg.hostname
    if (cfg.timezone) core.timezone = cfg.timezone
    if (cfg.kernels) core.kernels = cfg.kernels
    if (cfg.ntp !== undefined) core.ntp = cfg.ntp
    bike.core = core
  }

  if (cfg.locale_config) {
    bike.locale = {
      keyboard: cfg.locale_config.kb_layout,
      language: cfg.locale_config.sys_lang,
      encoding: cfg.locale_config.sys_enc,
    }
  }

  if (cfg.bootloader_config) {
    bike.boot = {
      loader: ARCHINSTALL_TO_LOADER[cfg.bootloader_config.bootloader],
      uki: cfg.bootloader_config.uki,
      removable: cfg.bootloader_config.removable,
    }
  }

  if (cfg.disk_config) {
    const encryptedSet = new Set(cfg.disk_config.disk_encryption?.partitions ?? [])
    bike.disk = cfg.disk_config.device_modifications.map((d) => ({
      device: d.device,
      wipe: d.wipe,
      table: 'gpt',
      partition: d.partitions.map((p, i) => {
        const out: Record<string, unknown> = {
          mount: p.mountpoint ?? '',
          fs: p.fs_type,
          size: p.original_size ?? formatSize(p.size),
        }
        if (i === 0) out.start = p.original_start ?? formatSize(p.start)
        if (p.flags.length > 0) out.flags = p.flags
        if (p.mount_options.length > 0) out.mount_options = p.mount_options
        if (p.btrfs.length > 0) {
          out.subvol = p.btrfs.map((s) => {
            const sv: Record<string, unknown> = { name: s.name }
            if (s.mountpoint) sv.mount = s.mountpoint
            return sv
          })
        }
        if (encryptedSet.has(p.obj_id)) out.encrypt = true
        return out
      }),
    }))
    if (cfg.disk_config.disk_encryption && cfg.disk_config.disk_encryption.encryption_type !== 'no_encryption') {
      bike.encryption = { type: cfg.disk_config.disk_encryption.encryption_type }
    }
  }

  if (cfg.swap) bike.swap = cfg.swap
  if (cfg.users && cfg.users.length > 0) {
    bike.user = cfg.users.map((u) => ({
      name: u.username,
      sudo: u.sudo,
      groups: u.groups,
    }))
  }
  if (cfg.packages && cfg.packages.length > 0) {
    const groups: Record<string, string[]> = {}
    for (const name of cfg.packages) {
      const repo = packageRepos[name] ?? 'extra'
      ;(groups[repo] ??= []).push(name)
    }
    for (const list of Object.values(groups)) list.sort()
    bike.packages = groups
  }
  if (cfg.network_config) bike.network = { mode: NET_MODE_REVERSE[cfg.network_config.type] }

  if (cfg.pacman_config || cfg.mirror_config) {
    const pacman: Record<string, unknown> = {}
    if (cfg.pacman_config) {
      pacman.color = cfg.pacman_config.color
      pacman.parallel_downloads = cfg.pacman_config.parallel_downloads
    }
    if (cfg.mirror_config) {
      const mirrors: Record<string, unknown> = {
        regions: Object.keys(cfg.mirror_config.mirror_regions),
      }
      if (cfg.mirror_config.custom_servers.length > 0) {
        mirrors.custom = cfg.mirror_config.custom_servers.map((s) => s.url)
      }
      pacman.mirrors = mirrors
    }
    bike.pacman = pacman
  }

  return stringifyToml(bike)
}
