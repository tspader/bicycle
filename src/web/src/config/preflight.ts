import type { ArchinstallConfig } from './schema'
import { sizeBytes } from './size'
import type { DiskInfo } from '../system'

export type PreflightResult = { ok: true; problems: [] } | { ok: false; problems: string[] }

// Returns a flat list of human-readable problems with the current state, or
// {ok: true} if the config can be handed to archinstall. Same idea as the
// inline overflow check, just for the whole config — used by /install before
// we let the user click through to a wipe.
export const preflight = (cfg: ArchinstallConfig, disks: DiskInfo[]): PreflightResult => {
  const problems: string[] = []
  if (!cfg.hostname) problems.push('Set a hostname on the System page.')
  if (!cfg.timezone) problems.push('Set a timezone on the System page.')
  if (!cfg.kernels || cfg.kernels.length === 0) problems.push('Pick a kernel on the System page.')
  if (!cfg.locale_config) problems.push('Set locale on the System page.')
  if (!cfg.bootloader_config) problems.push('Pick a bootloader on the Boot page.')

  const dc = cfg.disk_config
  if (!dc || dc.device_modifications.length === 0) {
    problems.push('Configure at least one disk on the Disk page.')
  } else if (dc.device_modifications.length > 1) {
    // The wipe-confirm UX assumes one target device. Until the install view
    // handles a multi-device confirm, refuse rather than mislead.
    problems.push('Multi-disk install is not yet supported; configure exactly one disk.')
  } else {
    let hasRoot = false
    let hasBoot = false
    for (const d of dc.device_modifications) {
      const disk = disks.find((x) => x.path === d.device)
      // Compare the *resolved* total against the real disk. This catches
      // both pure overflow ("200GiB" on a 30GiB disk) and stale "rest"
      // values left over from a config that was sized against a larger disk.
      const totalBytes = d.partitions.reduce((acc, p) => acc + sizeBytes(p.size), 0)
      if (disk && totalBytes > disk.size) {
        problems.push(`${d.device}: partitions total ${totalBytes} B but disk is ${disk.size} B.`)
      }
      if (!disk) problems.push(`${d.device}: not present on this machine.`)
      for (const p of d.partitions) {
        if (p.mountpoint === '/') hasRoot = true
        if (p.flags.includes('boot') || p.flags.includes('esp')) hasBoot = true
      }
    }
    // Both checks scan all device_modifications above.
    if (!hasRoot) problems.push('Partitions must include a "/" mountpoint.')
    if (!hasBoot) problems.push('Partitions must include a boot/esp partition.')

    const encryptedIds = new Set(dc.disk_encryption?.partitions ?? [])
    const anyEncrypted = encryptedIds.size > 0
    if (anyEncrypted && !cfg.encryption_password) {
      problems.push('Encrypted partitions require an encryption password (Disk page).')
    }
    if (!anyEncrypted && cfg.encryption_password) {
      problems.push('Encryption password is set but no partitions are marked encrypted.')
    }
  }

  const hasSudoer = (cfg.users ?? []).some((u) => u.sudo)
  const hasRootPw = !!cfg.root_enc_password
  if (!hasSudoer && !hasRootPw) {
    problems.push('Create a sudo user or set a root password on the Users page.')
  }

  return problems.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems }
}

// First wiping device — what the user types to confirm. Returns null when
// disk_config isn't set; preflight will have already complained in that case.
export const targetDevice = (cfg: ArchinstallConfig): string | null =>
  cfg.disk_config?.device_modifications[0]?.device ?? null
