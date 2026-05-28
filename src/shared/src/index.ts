import { z } from 'zod'

export * as vars from './vars'
export { loadBicycleDoc } from './loader'
export type { LoadedDoc } from './loader'

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

export const SudoMode = z.enum(['none', 'password', 'passwordless'])
export type SudoMode = z.infer<typeof SudoMode>

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
  uid: z.number().int().nonnegative().optional(),
  // none: no sudo. password: full sudo, password required. passwordless: full
  // sudo with NOPASSWD. The sudoers reconciler writes a drop-in per sudo user;
  // membership in `wheel` alone grants nothing without that rule.
  sudo: SudoMode,
  groups: z.array(z.string()),
  // A secret reference (e.g. "${secret:users/spader/password}") pointing at
  // an age-encrypted file holding the user's CLEAR password. The installer
  // decrypts + hashes it for archinstall at install time; the daemon decrypts
  // it and applies it with chpasswd at reconcile time. Stored clear (inside
  // the age envelope) because some flows genuinely need the plaintext.
  password: z.string().min(1).optional(),
}).strict()
export type User = z.infer<typeof User>

const Group = z.object({
  name: z.string().min(1),
  gid: z.number().int().nonnegative(),
}).strict()
export type Group = z.infer<typeof Group>

const OCTAL_MODE = /^0[0-7]{3,4}$/
const Dir = z.object({
  path: z.string().min(1).refine((p) => p.startsWith('/'), {
    message: 'path must be absolute',
  }),
  owner: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
  mode: z.string().regex(OCTAL_MODE, 'mode must be octal like "0775" or "02775"').optional(),
}).strict()
export type Dir = z.infer<typeof Dir>

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const VarScalar = z.union([z.string(), z.number(), z.boolean()])
const VarValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([VarScalar, z.record(z.string().regex(IDENT), VarValue)]),
)
export const Vars = z.record(z.string().regex(IDENT), VarValue)
export type Vars = z.infer<typeof Vars>

export const BicycleConfig = z.object({
  vars: Vars.optional(),
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
  groups: z.array(Group).optional(),
  dirs: z.array(Dir).optional(),
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
