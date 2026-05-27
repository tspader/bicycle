import { z } from 'zod'

export const Kernel = z.enum(['linux', 'linux-lts', 'linux-zen', 'linux-hardened'])
export type Kernel = z.infer<typeof Kernel>

export const LoaderName = z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind'])
export type LoaderName = z.infer<typeof LoaderName>

export const FsType = z.enum([
  'btrfs', 'ext2', 'ext3', 'ext4', 'f2fs', 'fat12', 'fat16', 'fat32', 'ntfs', 'xfs', 'linux-swap',
])
export type FsType = z.infer<typeof FsType>

export const PartitionFlag = z.enum(['boot', 'esp', 'bls_boot', 'linux-home', 'swap'])
export type PartitionFlag = z.infer<typeof PartitionFlag>

export const EncryptionKind = z.enum(['luks', 'lvm_on_luks', 'luks_on_lvm'])
export type EncryptionKind = z.infer<typeof EncryptionKind>

export const NetworkMode = z.enum(['iso', 'networkmanager'])
export type NetworkMode = z.infer<typeof NetworkMode>

export const SwapAlgorithm = z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc'])
export type SwapAlgorithm = z.infer<typeof SwapAlgorithm>

export const PartitionTable = z.enum(['gpt', 'mbr'])
export type PartitionTable = z.infer<typeof PartitionTable>

const Subvolume = z.object({
  name: z.string().min(1),
  mount: z.string().min(1).optional(),
}).strict()
export type Subvolume = z.infer<typeof Subvolume>

const Partition = z.object({
  mount: z.string().min(1).optional(),
  fs: FsType,
  size: z.string().min(1),
  start: z.string().min(1).optional(),
  flags: z.array(PartitionFlag).optional(),
  mount_options: z.array(z.string().min(1)).optional(),
  subvolumes: z.array(Subvolume).optional(),
  encrypt: z.boolean().optional(),
}).strict()
export type Partition = z.infer<typeof Partition>

const Disk = z.object({
  device: z.string().min(1),
  wipe: z.boolean(),
  table: PartitionTable,
  partitions: z.array(Partition).min(1),
}).strict()
export type Disk = z.infer<typeof Disk>

const User = z.object({
  name: z.string().min(1),
  sudo: z.boolean(),
  groups: z.array(z.string()),
}).strict()
export type User = z.infer<typeof User>

export const BicycleConfig = z.object({
  core: z.object({
    hostname: z.string().min(1),
    timezone: z.string().min(1),
    kernels: z.array(Kernel).min(1),
    ntp: z.boolean(),
  }).strict().optional(),
  locale: z.object({
    keyboard: z.string().min(1),
    language: z.string().min(1),
    encoding: z.string().min(1),
  }).strict().optional(),
  boot: z.object({
    loader: LoaderName,
    uki: z.boolean(),
    removable: z.boolean(),
  }).strict().optional(),
  disks: z.array(Disk).optional(),
  swap: z.object({
    enabled: z.boolean(),
    algorithm: SwapAlgorithm,
  }).strict().optional(),
  users: z.array(User).optional(),
  packages: z.record(z.string(), z.array(z.string())).optional(),
  pacman: z.object({
    color: z.boolean().optional(),
    parallel_downloads: z.number().int().nonnegative().optional(),
    mirrors: z.object({
      regions: z.array(z.string()),
      custom: z.array(z.string().url()).optional(),
    }).strict().optional(),
  }).strict().optional(),
  network: z.object({
    mode: NetworkMode,
  }).strict().optional(),
  encryption: z.object({
    type: EncryptionKind,
  }).strict().optional(),
  catalog: z.object({
    url: z.string().min(1),
  }).strict().optional(),
  systemd: z.object({
    enable: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict()
export type BicycleConfig = z.infer<typeof BicycleConfig>
