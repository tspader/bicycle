import type { Disk, FsType, Partition, PartitionFlag } from '@bicycle/shared'

// Each preset is a list of bicycle-shape partitions (size as a string, no
// obj_id/start). The projection (project() in yaml.ts) resolves them against a
// real disk: the first partition starts at 1 MiB, "rest" fills the tail minus
// the GPT backup header.
export type PresetPart = {
  mount: string
  fs: FsType
  size: string
  flags?: PartitionFlag[]
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

// Convert a preset part to a bicycle.yml partition. The first partition gets an
// explicit start (1 MiB); the rest derive theirs from the cursor at projection
// time. undefined fields are dropped by doc.node so optional keys aren't
// emitted.
export const presetPartition = (p: PresetPart, first: boolean): Partition => ({
  mount: p.mount,
  fs: p.fs,
  size: p.size,
  start: first ? '1MiB' : undefined,
  flags: p.flags && p.flags.length > 0 ? p.flags : undefined,
  mount_options: p.mount_options && p.mount_options.length > 0 ? p.mount_options : undefined,
  subvolumes:
    p.subvol && p.subvol.length > 0
      ? p.subvol.map((s) => ({ name: s.name, mount: s.mount }))
      : undefined,
  encrypt: p.encrypt ? true : undefined,
}) as Partition

export const presetDisk = (id: PresetId, device: string): Disk => ({
  device,
  wipe: true,
  table: 'gpt',
  partitions: PRESETS[id].parts.map((p, i) => presetPartition(p, i === 0)),
})
