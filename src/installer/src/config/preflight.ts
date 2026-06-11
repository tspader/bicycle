import type { ArchinstallConfig } from './schema'
import type { SudoMode } from '@bicycle/shared'
import { sizeBytes } from './size'
import type { DiskInfo } from '../system'
import type { CategoryId } from '../ui-state'

export type Severity = 'error' | 'warning'

export type Warning = {
  severity: Severity
  message: string
  category?: CategoryId
}

// A bicycle.yml user, summarized to what preflight needs (without decrypting).
export type AccountSummary = { name: string; sudo: SudoMode; hasPassword: boolean }

// Everything preflight needs beyond the projected archinstall config: the
// in-memory identity, whether a root/LUKS password is set, and the declared
// accounts. (Users and root/LUKS passwords are not part of the projection —
// they live in bicycle.yml / transient installer creds.)
export type PreflightCtx = {
  identity?: string | null
  rootSet?: boolean
  encryptionSet?: boolean
  accounts?: AccountSummary[]
}

export const deriveWarnings = (
  cfg: ArchinstallConfig,
  disks: DiskInfo[],
  ctx: PreflightCtx = {},
): Warning[] => {
  const out: Warning[] = []
  const err = (message: string, category?: CategoryId) =>
    out.push({ severity: 'error', message, category })
  const warn = (message: string, category?: CategoryId) =>
    out.push({ severity: 'warning', message, category })

  if (!cfg.hostname) err('Set a hostname.', 'system')
  if (!cfg.timezone) err('Set a timezone.', 'system')
  if (!cfg.kernels || cfg.kernels.length === 0) err('Pick a kernel.', 'boot')
  if (!cfg.locale_config) err('Set locale.', 'system')
  if (!cfg.bootloader_config) err('Pick a bootloader.', 'boot')

  const dc = cfg.disk_config
  if (!dc || dc.device_modifications.length === 0) {
    err('Configure at least one disk.', 'disk')
  } else if (dc.device_modifications.length > 1) {
    err('Multi-disk install is not yet supported; configure exactly one disk.', 'disk')
  } else {
    let hasRoot = false
    let hasBoot = false
    const mountCounts = new Map<string, number>()
    const mount = (m: string | null) => {
      if (m) mountCounts.set(m, (mountCounts.get(m) ?? 0) + 1)
    }
    for (const d of dc.device_modifications) {
      const disk = disks.find((x) => x.path === d.device)
      if (!disk) {
        err(`${d.device}: not present on this machine.`, 'disk')
      } else {
        const totalBytes = d.partitions.reduce((acc, p) => acc + sizeBytes(p.size), 0)
        if (totalBytes > disk.size) {
          err(`${d.device}: partitions total ${totalBytes} B but disk is ${disk.size} B.`, 'disk')
        }
      }
      for (const p of d.partitions) {
        if (p.flags.includes('boot') || p.flags.includes('esp')) hasBoot = true
        // Subvolumes carry the real mounts for a btrfs partition; its own
        // mountpoint is vestigial there and must not count as a duplicate.
        if (p.btrfs.length > 0) {
          for (const sv of p.btrfs) {
            if (sv.mountpoint === '/') hasRoot = true
            mount(sv.mountpoint)
          }
        } else {
          if (p.mountpoint === '/') hasRoot = true
          mount(p.mountpoint)
        }
      }
    }
    if (!hasRoot) err('Partitions must include a "/" mountpoint.', 'disk')
    if (!hasBoot) err('Partitions must include a boot/esp partition.', 'disk')
    for (const [m, count] of mountCounts) {
      if (count > 1) err(`${m} is mounted ${count} times; mountpoints must be unique.`, 'disk')
    }

    const anyEncrypted = (dc.disk_encryption?.partitions.length ?? 0) > 0
    if (anyEncrypted && !ctx.encryptionSet) {
      err('Encrypted partitions require an encryption password.', 'disk')
    }
    if (!anyEncrypted && ctx.encryptionSet) {
      err('Encryption password is set but no partitions are marked encrypted.', 'disk')
    }
  }

  // A declared account with no password can't log in (and has no secret to
  // decrypt). Surface it per-user rather than blocking edits inline.
  for (const a of ctx.accounts ?? []) {
    if (!a.hasPassword) warn(`User "${a.name}" has no password.`, 'users')
  }

  const sudoers = (ctx.accounts ?? []).filter((u) => u.sudo !== 'none')
  const sudoerWithPw = sudoers.some((u) => u.hasPassword)
  // A declared sudoer can supply the login, but only if an age identity is
  // available to decrypt its password secret on the target at first boot.
  const usableSudoer = ctx.identity != null && sudoerWithPw
  if (!ctx.rootSet && !usableSudoer) {
    if (sudoerWithPw) {
      err('Set an age identity so the user password secret can be decrypted.', 'import')
    } else {
      err('Create a sudo user with a password, or set a root password.', 'users')
    }
  }

  if (!ctx.identity) {
    warn('No age identity set — secrets will not be decryptable on the installed system.', 'import')
  }

  return out
}

export type PreflightResult = { ok: true; problems: [] } | { ok: false; problems: string[] }

export const preflight = (
  cfg: ArchinstallConfig,
  disks: DiskInfo[],
  ctx: PreflightCtx = {},
): PreflightResult => {
  const problems = deriveWarnings(cfg, disks, ctx)
    .filter((w) => w.severity === 'error')
    .map((w) => w.message)
  return problems.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems }
}

export const targetDevice = (cfg: ArchinstallConfig): string | null =>
  cfg.disk_config?.device_modifications[0]?.device ?? null
