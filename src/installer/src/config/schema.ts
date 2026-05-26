import { z } from 'zod'
import { Size } from './size'

export const Kernel = z.enum(['linux', 'linux-lts', 'linux-zen', 'linux-hardened'])
export type Kernel = z.infer<typeof Kernel>

export const Bootloader = z.enum(['Systemd-boot', 'Grub', 'Efistub', 'Limine', 'Refind'])
export type Bootloader = z.infer<typeof Bootloader>

export const FsType = z.enum(['btrfs', 'ext2', 'ext3', 'ext4', 'f2fs', 'fat12', 'fat16', 'fat32', 'ntfs', 'xfs', 'linux-swap'])
export type FsType = z.infer<typeof FsType>

export const PartitionFlag = z.enum(['boot', 'esp', 'bls_boot', 'linux-home', 'swap'])
export type PartitionFlag = z.infer<typeof PartitionFlag>

export const PartitionStatus = z.enum(['create', 'existing', 'modify', 'delete'])
export const PartitionType = z.enum(['primary', 'boot', 'unknown'])

export const SubvolumeModification = z.object({
  name: z.string().min(1),
  mountpoint: z.string().nullable(),
})

export const PartitionConfig = z.object({
  obj_id: z.string().uuid(),
  status: PartitionStatus,
  type: PartitionType,
  fs_type: FsType,
  mountpoint: z.string().nullable(),
  flags: z.array(PartitionFlag),
  start: Size,
  size: Size,
  btrfs: z.array(SubvolumeModification),
  dev_path: z.string().nullable(),
  mount_options: z.array(z.string()),
  // Bicycle-only: the original size/start strings the user typed ("1GiB", "rest",
  // "1MiB"). Preserved so the TOML preview can show what the user actually wrote,
  // rather than the resolved bytes. archinstall ignores unknown partition keys.
  original_size: z.string().optional(),
  original_start: z.string().optional(),
})
export type PartitionConfig = z.infer<typeof PartitionConfig>

export const DeviceModification = z.object({
  device: z.string().min(1),
  wipe: z.boolean(),
  partitions: z.array(PartitionConfig),
})
export type DeviceModification = z.infer<typeof DeviceModification>

export const EncryptionType = z.enum(['no_encryption', 'luks', 'lvm_on_luks', 'luks_on_lvm'])
export type EncryptionType = z.infer<typeof EncryptionType>

export const DiskEncryption = z.object({
  encryption_type: EncryptionType,
  partitions: z.array(z.string().uuid()),
  lvm_volumes: z.array(z.string().uuid()),
})
export type DiskEncryption = z.infer<typeof DiskEncryption>

export const DiskConfig = z.object({
  config_type: z.literal('manual_partitioning'),
  device_modifications: z.array(DeviceModification),
  btrfs_options: z.object({ snapshot_config: z.null() }),
  disk_encryption: DiskEncryption.optional(),
})

export const LocaleConfig = z.object({
  kb_layout: z.string().min(1),
  sys_lang: z.string().min(1),
  sys_enc: z.string().min(1),
})
export type LocaleConfig = z.infer<typeof LocaleConfig>

export const BootloaderConfig = z.object({
  bootloader: Bootloader,
  uki: z.boolean(),
  removable: z.boolean(),
})

export const SwapConfig = z.object({
  enabled: z.boolean(),
  algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']),
})

export const NetworkConfig = z.object({
  type: z.enum(['iso', 'nm']),
})

export const PacmanConfig = z.object({
  color: z.boolean(),
  parallel_downloads: z.number().int().nonnegative(),
})

export const MirrorConfig = z.object({
  mirror_regions: z.record(z.string(), z.array(z.string())),
  custom_servers: z.array(z.object({ url: z.string().url() })),
  custom_repositories: z.array(z.unknown()),
  optional_repositories: z.array(z.enum(['multilib', 'testing'])),
})

export const User = z.object({
  username: z.string().min(1),
  sudo: z.boolean(),
  groups: z.array(z.string()),
  enc_password: z.string().min(1),
})
export type User = z.infer<typeof User>

export const ArchinstallConfig = z.object({
  hostname: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  kernels: z.array(Kernel).optional(),
  ntp: z.boolean().optional(),
  locale_config: LocaleConfig.optional(),
  bootloader_config: BootloaderConfig.optional(),
  disk_config: DiskConfig.optional(),
  swap: SwapConfig.optional(),
  network_config: NetworkConfig.optional(),
  pacman_config: PacmanConfig.optional(),
  mirror_config: MirrorConfig.optional(),
  packages: z.array(z.string()).optional(),
  users: z.array(User).optional(),
  root_enc_password: z.string().nullable().optional(),
  encryption_password: z.string().min(1).optional(),
})
export type ArchinstallConfig = z.infer<typeof ArchinstallConfig>
