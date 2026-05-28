import type { ArchinstallConfig } from './schema'
import { sizeBytes } from './size'
import type { DiskInfo } from '../system'
import type { CategoryId } from '../ui-state'

export type Severity = 'error' | 'warning'

export type Warning = {
  severity: Severity
  message: string
  category?: CategoryId
}

// A source (YAML) user that could be promoted into an archinstall account at
// install time, summarized to what preflight needs without decrypting.
export type PendingUser = { sudo: boolean; hasPassword: boolean }

export const deriveWarnings = (
  cfg: ArchinstallConfig,
  disks: DiskInfo[],
  ageKey: string | null = null,
  pending: PendingUser[] = [],
): Warning[] => {
  const out: Warning[] = []
  const err = (message: string, category?: CategoryId) =>
    out.push({ severity: 'error', message, category })
  const warn = (message: string, category?: CategoryId) =>
    out.push({ severity: 'warning', message, category })

  if (!cfg.hostname) err('Set a hostname.', 'system')
  if (!cfg.timezone) err('Set a timezone.', 'system')
  if (!cfg.kernels || cfg.kernels.length === 0) err('Pick a kernel.', 'system')
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
        if (p.mountpoint === '/') hasRoot = true
        if (p.flags.includes('boot') || p.flags.includes('esp')) hasBoot = true
      }
    }
    if (!hasRoot) err('Partitions must include a "/" mountpoint.', 'disk')
    if (!hasBoot) err('Partitions must include a boot/esp partition.', 'disk')

    const encryptedIds = new Set(dc.disk_encryption?.partitions ?? [])
    const anyEncrypted = encryptedIds.size > 0
    if (anyEncrypted && !cfg.encryption_password) {
      err('Encrypted partitions require an encryption password.', 'disk')
    }
    if (!anyEncrypted && cfg.encryption_password) {
      err('Encryption password is set but no partitions are marked encrypted.', 'disk')
    }
  }

  const hasSudoer = (cfg.users ?? []).some((u) => u.sudo)
  const hasRootPw = !!cfg.root_enc_password
  // A source YAML sudoer with a password secret can supply the login too — but
  // only if an age identity is available to decrypt it at install time.
  const pendingSudoerWithPw = pending.some((p) => p.sudo && p.hasPassword)
  const hasPendingSudoer = ageKey != null && pendingSudoerWithPw
  if (!hasSudoer && !hasRootPw && !hasPendingSudoer) {
    // Emit exactly one error: if a promotable sudoer exists but the age key
    // is missing, point at that specific fix; otherwise the generic one.
    if (pendingSudoerWithPw) {
      err('Set an age identity so the imported user password can be decrypted.', 'import')
    } else {
      err('Create a sudo user or set a root password.', 'users')
    }
  }

  if (!ageKey) {
    warn('No age identity set — secrets will not be decryptable on the installed system.', 'import')
  }

  return out
}

export type PreflightResult = { ok: true; problems: [] } | { ok: false; problems: string[] }

export const preflight = (
  cfg: ArchinstallConfig,
  disks: DiskInfo[],
  ageKey: string | null = null,
  pending: PendingUser[] = [],
): PreflightResult => {
  const problems = deriveWarnings(cfg, disks, ageKey, pending)
    .filter((w) => w.severity === 'error')
    .map((w) => w.message)
  return problems.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems }
}

export const targetDevice = (cfg: ArchinstallConfig): string | null =>
  cfg.disk_config?.device_modifications[0]?.device ?? null
