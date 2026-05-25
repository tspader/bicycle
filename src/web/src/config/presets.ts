import type { PartitionConfig } from './schema'
import { DEFAULT_SECTOR, parseSize } from './size'
import type { MachineCtx } from './machine'

// Each preset is a list of bicycle-shape partitions (size as a string, no
// obj_id/start, etc). buildPartitions() resolves them against a real disk via
// MachineCtx, applying the same arithmetic as fromToml: first partition starts
// at 1 MiB, "rest" fills the tail minus the GPT backup header.
export type PresetPart = {
  mount: string
  fs: PartitionConfig['fs_type']
  size: string
  flags?: PartitionConfig['flags']
  mount_options?: string[]
  subvol?: Array<{ name: string; mount?: string }>
  encrypt?: boolean
}

export type PresetId = 'single_root' | 'root_home' | 'btrfs_subvols' | 'encrypted_btrfs'

export const PRESETS: Record<PresetId, { label: string; parts: PresetPart[]; needsEncryption?: boolean }> = {
  single_root: {
    label: 'Single root (ext4)',
    parts: [
      { mount: '/boot', fs: 'fat32', size: '512MiB', flags: ['boot', 'esp'] },
      { mount: '/', fs: 'ext4', size: 'rest' },
    ],
  },
  root_home: {
    label: 'Root + home (ext4)',
    parts: [
      { mount: '/boot', fs: 'fat32', size: '512MiB', flags: ['boot', 'esp'] },
      { mount: '/', fs: 'ext4', size: '60GiB' },
      { mount: '/home', fs: 'ext4', size: 'rest' },
    ],
  },
  btrfs_subvols: {
    label: 'Btrfs subvolumes',
    parts: [
      { mount: '/boot', fs: 'fat32', size: '512MiB', flags: ['boot', 'esp'] },
      {
        mount: '/',
        fs: 'btrfs',
        size: 'rest',
        mount_options: ['compress=zstd', 'noatime'],
        subvol: [
          { name: '@', mount: '/' },
          { name: '@home', mount: '/home' },
          { name: '@log', mount: '/var/log' },
          { name: '@pkg', mount: '/var/cache/pacman/pkg' },
        ],
      },
    ],
  },
  encrypted_btrfs: {
    label: 'Encrypted btrfs',
    needsEncryption: true,
    parts: [
      { mount: '/boot', fs: 'fat32', size: '512MiB', flags: ['boot', 'esp'] },
      {
        mount: '/',
        fs: 'btrfs',
        size: 'rest',
        encrypt: true,
        mount_options: ['compress=zstd', 'noatime'],
        subvol: [
          { name: '@', mount: '/' },
          { name: '@home', mount: '/home' },
          { name: '@log', mount: '/var/log' },
          { name: '@pkg', mount: '/var/cache/pacman/pkg' },
        ],
      },
    ],
  },
}

const MIB = 1024 ** 2

// Convert a list of preset/bicycle-shape parts into resolved PartitionConfigs
// for a specific disk. Throws on the same conditions fromToml does.
export const buildPartitions = (
  parts: PresetPart[],
  device: string,
  ctx: MachineCtx,
): { partitions: PartitionConfig[]; encryptedObjIds: string[] } => {
  const lastIdx = parts.length - 1
  const encryptedObjIds: string[] = []
  let cursor: number | null = null

  const partitions: PartitionConfig[] = parts.map((p, i) => {
    if (p.fs !== 'btrfs' && p.subvol && p.subvol.length > 0) {
      throw new Error(`partition ${p.mount}: subvol requires fs="btrfs"`)
    }
    if (p.size === 'rest' && i !== lastIdx) {
      throw new Error(`partition ${p.mount}: "rest" is only allowed on the last partition`)
    }

    let startBytes: number
    let originalStart: string | undefined
    if (i === 0) {
      startBytes = MIB
      originalStart = '1MiB'
    } else {
      if (cursor === null) throw new Error(`partition ${p.mount}: cannot derive start`)
      startBytes = cursor
    }

    let sizeBytes: number
    if (p.size === 'rest') {
      const totalBytes = ctx.diskSize(device)
      const usableEnd = totalBytes - MIB // GPT backup tail
      const restBytes = usableEnd - startBytes
      if (restBytes <= 0) throw new Error(`no space left for "rest" partition ${p.mount}`)
      sizeBytes = restBytes - (restBytes % MIB)
    } else {
      const s = parseSize(p.size)
      const mul: Record<typeof s.unit, number> = {
        B: 1, KiB: 1024, MiB: MIB, GiB: 1024 ** 3, TiB: 1024 ** 4,
      }
      sizeBytes = s.value * mul[s.unit]
    }

    cursor = startBytes + sizeBytes
    const obj_id = ctx.uuid()
    if (p.encrypt) encryptedObjIds.push(obj_id)

    return {
      obj_id,
      status: 'create',
      type: 'primary',
      fs_type: p.fs,
      mountpoint: p.mount,
      flags: p.flags ?? [],
      start: { unit: 'B', value: startBytes, sector_size: DEFAULT_SECTOR },
      size: { unit: 'B', value: sizeBytes, sector_size: DEFAULT_SECTOR },
      btrfs: (p.subvol ?? []).map((s) => ({ name: s.name, mountpoint: s.mount ?? null })),
      dev_path: null,
      mount_options: p.mount_options ?? [],
      original_size: p.size,
      ...(originalStart ? { original_start: originalStart } : {}),
    }
  })

  return { partitions, encryptedObjIds }
}
