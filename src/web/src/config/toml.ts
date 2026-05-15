import { parse as parseTomlText, stringify as stringifyToml } from 'smol-toml'
import { z } from 'zod'
import { ArchinstallConfig, FsType, PartitionFlag, Kernel, Bootloader } from './schema'
import { Size, DEFAULT_SECTOR, parseSize, formatSize } from './size'
import { randomUUID } from 'node:crypto'

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

const BicyclePartition = z.object({
  mount: z.string().min(1),
  fs: FsType,
  size: z.string().min(1),
  start: z.string().min(1).optional(),
  flags: z.array(PartitionFlag).optional(),
})

const BicycleDisk = z.object({
  device: z.string().min(1),
  wipe: z.boolean(),
  table: z.enum(['gpt', 'mbr']),
  partition: z.array(BicyclePartition).min(1),
})

const BicycleUser = z.object({
  name: z.string().min(1),
  sudo: z.boolean(),
  groups: z.array(z.string()),
})

const BicycleToml = z.object({
  core: z
    .object({
      hostname: z.string().min(1),
      timezone: z.string().min(1),
      kernels: z.array(Kernel).min(1),
      ntp: z.boolean(),
    })
    .optional(),
  locale: z
    .object({
      keyboard: z.string().min(1),
      language: z.string().min(1),
      encoding: z.string().min(1),
    })
    .optional(),
  boot: z
    .object({
      loader: LoaderName,
      uki: z.boolean(),
      removable: z.boolean(),
    })
    .optional(),
  disk: z.array(BicycleDisk).optional(),
  swap: z
    .object({
      enabled: z.boolean(),
      algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']),
    })
    .optional(),
  user: z.array(BicycleUser).optional(),
  packages: z.object({ extra: z.array(z.string()) }).optional(),
  pacman: z
    .object({
      color: z.boolean().optional(),
      parallel_downloads: z.number().int().nonnegative().optional(),
      mirrors: z
        .object({
          regions: z.array(z.string()).min(1),
          custom: z.array(z.string().url()).optional(),
        })
        .optional(),
    })
    .optional(),
  network: z
    .object({
      mode: z.enum(['iso', 'networkmanager', 'iwd', 'manual']),
    })
    .optional(),
}).strict()
export type BicycleToml = z.infer<typeof BicycleToml>

const NET_MODE: Record<z.infer<typeof BicycleToml>['network'] extends infer T ? T extends { mode: infer M } ? M : never : never, 'iso' | 'nm' | 'nm_iwd' | 'manual'> = {
  iso: 'iso',
  networkmanager: 'nm',
  iwd: 'nm_iwd',
  manual: 'manual',
}

const NET_MODE_REVERSE: Record<'iso' | 'nm' | 'nm_iwd' | 'manual', 'iso' | 'networkmanager' | 'iwd' | 'manual'> = {
  iso: 'iso',
  nm: 'networkmanager',
  nm_iwd: 'iwd',
  manual: 'manual',
}

const sizeBytes = (s: Size): number => {
  const mul: Record<Size['unit'], number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
    Percent: 0,
  }
  if (s.unit === 'Percent') throw new Error('cannot resolve Percent size to bytes')
  return s.value * mul[s.unit]
}

const addBytes = (a: Size, bytes: number): Size => {
  const total = sizeBytes(a) + bytes
  return { unit: 'B', value: total, sector_size: DEFAULT_SECTOR }
}

export const fromToml = (text: string): ArchinstallConfig => {
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
    out.disk_config = {
      config_type: 'manual_partitioning',
      btrfs_options: { snapshot_config: null },
      device_modifications: bike.disk.map((d) => {
        let cursor: Size | null = null
        return {
          device: d.device,
          wipe: d.wipe,
          partitions: d.partition.map((p, i) => {
            const size = parseSize(p.size)
            let start: Size
            if (p.start) {
              start = parseSize(p.start)
            } else if (i === 0) {
              throw new Error(`disk ${d.device}: first partition must specify start`)
            } else if (cursor === null) {
              throw new Error(`disk ${d.device}: cannot derive start after a non-byte-sized partition`)
            } else {
              start = cursor
            }
            if (size.unit !== 'Percent') {
              cursor = addBytes(start, sizeBytes(size))
            } else {
              cursor = null
            }
            return {
              obj_id: randomUUID(),
              status: 'create' as const,
              type: 'primary' as const,
              fs_type: p.fs,
              mountpoint: p.mount,
              flags: p.flags ?? [],
              start,
              size,
              btrfs: [],
              dev_path: null,
              mount_options: [],
            }
          }),
        }
      }),
    }
  }

  if (bike.swap) out.swap = bike.swap
  if (bike.user) {
    out.users = bike.user.map((u) => ({
      username: u.name,
      sudo: u.sudo,
      groups: u.groups,
      enc_password: null,
    }))
  }
  if (bike.packages) out.packages = bike.packages.extra
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
      for (const r of bike.pacman.mirrors.regions) regions[r] = []
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

export const toToml = (cfg: ArchinstallConfig): string => {
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
    bike.disk = cfg.disk_config.device_modifications.map((d) => ({
      device: d.device,
      wipe: d.wipe,
      table: 'gpt',
      partition: d.partitions.map((p, i) => {
        const isLast = i === d.partitions.length - 1
        const out: Record<string, unknown> = {
          mount: p.mountpoint ?? '',
          fs: p.fs_type,
          size: formatSize(p.size, { isLast }),
        }
        if (i === 0) out.start = formatSize(p.start)
        if (p.flags.length > 0) out.flags = p.flags
        return out
      }),
    }))
  }

  if (cfg.swap) bike.swap = cfg.swap
  if (cfg.users && cfg.users.length > 0) {
    bike.user = cfg.users.map((u) => ({
      name: u.username,
      sudo: u.sudo,
      groups: u.groups,
    }))
  }
  if (cfg.packages && cfg.packages.length > 0) bike.packages = { extra: cfg.packages }
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
