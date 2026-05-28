import {
  loadBicycleDoc,
  LoaderName,
  type BicycleConfig,
  type EncryptionKind,
} from '@bicycle/shared'
import { ArchinstallConfig, Bootloader, EncryptionType } from './schema'
import { Size, DEFAULT_SECTOR, parseSize, formatSize, sizeBytes } from './size'
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
const ARCHINSTALL_TO_LOADER: Record<Bootloader, LoaderName> = Object.fromEntries(
  Object.entries(LOADER_TO_ARCHINSTALL).map(([k, v]) => [v, k]),
) as never

const NET_MODE: Record<'iso' | 'networkmanager', 'iso' | 'nm'> = {
  iso: 'iso',
  networkmanager: 'nm',
}

const NET_MODE_REVERSE: Record<'iso' | 'nm', 'iso' | 'networkmanager'> = {
  iso: 'iso',
  nm: 'networkmanager',
}

export type RetainedDoc = {
  catalog?: BicycleConfig['catalog']
  systemd?: BicycleConfig['systemd']
  // Users declared in an imported bicycle.yml. They carry password *secret
  // refs* (and possibly a uid), neither of which ArchinstallConfig.User can
  // hold, so — like catalog/systemd — they're retained verbatim rather than
  // folded into `config.users`. toYaml re-emits them so a dirty (UI-edited)
  // import doesn't silently drop imported users from the regenerated
  // bicycle.yml. UI-created users (config.users) take precedence on name
  // conflict, matching mergeUsers() at install time.
  users?: BicycleConfig['users']
  // Bicycle-only sections the daemon reconciles (groups.ts / dirs.ts) but
  // archinstall knows nothing about. Like the above, they're retained so a
  // dirty (UI-edited) import doesn't drop them from the regenerated
  // bicycle.yml. Their `${var}` refs are already resolved at load time.
  groups?: BicycleConfig['groups']
  dirs?: BicycleConfig['dirs']
}

export type YamlImport = {
  config: ArchinstallConfig
  retained: RetainedDoc
}

const addBytes = (a: Size, bytes: number): Size => {
  const total = sizeBytes(a) + bytes
  return { unit: 'B', value: total, sector_size: DEFAULT_SECTOR }
}

export const fromYaml = (text: string, ctx: MachineCtx): YamlImport => {
  const bike = loadBicycleDoc(text).resolved
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
            original_size: p.size,
            ...(p.start ? { original_start: p.start } : {}),
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

  return {
    config: ArchinstallConfig.parse(out),
    retained: {
      ...(bike.catalog ? { catalog: bike.catalog } : {}),
      ...(bike.systemd ? { systemd: bike.systemd } : {}),
      ...(bike.users && bike.users.length > 0 ? { users: bike.users } : {}),
      ...(bike.groups && bike.groups.length > 0 ? { groups: bike.groups } : {}),
      ...(bike.dirs && bike.dirs.length > 0 ? { dirs: bike.dirs } : {}),
    },
  }
}

export const toYaml = (
  cfg: ArchinstallConfig,
  retained: RetainedDoc = {},
  packageRepos: Record<string, string> = {},
): string => {
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
    bike.disks = cfg.disk_config.device_modifications.map((d) => ({
      device: d.device,
      wipe: d.wipe,
      table: 'gpt',
      partitions: d.partitions.map((p, i) => {
        const out: Record<string, unknown> = {
          fs: p.fs_type,
          size: p.original_size ?? formatSize(p.size),
        }
        if (p.mountpoint) out.mount = p.mountpoint
        if (i === 0) out.start = p.original_start ?? formatSize(p.start)
        if (p.flags.length > 0) out.flags = p.flags
        if (p.mount_options.length > 0) out.mount_options = p.mount_options
        if (p.btrfs.length > 0) {
          out.subvolumes = p.btrfs.map((s) => {
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
      bike.encryption = { type: cfg.disk_config.disk_encryption.encryption_type as EncryptionKind }
    }
  }

  if (cfg.swap) bike.swap = cfg.swap
  // Merge imported users (retained, with their original secret refs + uid)
  // with UI-created users (cfg.users). A Map keyed by name keeps imported
  // ordering while letting UI users override a same-named import — consistent
  // with mergeUsers() at install. Imported users are placed first so they
  // retain their slots; UI-only users are appended.
  const usersByName = new Map<string, Record<string, unknown>>()
  for (const u of retained.users ?? []) {
    const entry: Record<string, unknown> = { name: u.name }
    if (u.uid !== undefined) entry.uid = u.uid
    entry.sudo = u.sudo
    entry.groups = u.groups
    if (u.password !== undefined) entry.password = u.password
    usersByName.set(u.name, entry)
  }
  for (const u of cfg.users ?? []) {
    usersByName.set(u.username, {
      name: u.username,
      sudo: u.sudo ? 'password' : 'none',
      groups: u.groups,
      // The cleartext password is encrypted to <etc>/secrets/users/<name>/
      // password.age at install; the daemon resolves this ref + applies it with
      // chpasswd. archinstall still gets the hashed enc_password via --creds.
      password: `\${secret:users/${u.username}/password}`,
    })
  }
  if (usersByName.size > 0) bike.users = [...usersByName.values()]
  // Retained Bicycle-only sections (resolved at import) — pass through verbatim.
  if (retained.groups && retained.groups.length > 0) bike.groups = retained.groups
  if (retained.dirs && retained.dirs.length > 0) bike.dirs = retained.dirs
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

  if (retained.catalog) bike.catalog = retained.catalog
  if (retained.systemd) bike.systemd = retained.systemd

  return Bun.YAML.stringify(bike, null, 2)
}
