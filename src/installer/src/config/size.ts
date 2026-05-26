import { z } from 'zod'

export const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const
export type SizeUnit = (typeof SIZE_UNITS)[number]

export const SectorSize = z.object({
  unit: z.literal('B'),
  value: z.number().int().positive(),
})

export const Size = z.object({
  unit: z.enum(SIZE_UNITS),
  value: z.number().nonnegative(),
  sector_size: SectorSize,
})

export type Size = z.infer<typeof Size>

export const DEFAULT_SECTOR: z.infer<typeof SectorSize> = { unit: 'B', value: 512 }

const SIZE_RE = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/

// Accept common variants case-insensitively and normalize to canonical IEC.
// Disk-sizing UIs and tools (parted, sgdisk, fdisk) treat MB/GB and MiB/GiB
// interchangeably for layout purposes, so we follow suit rather than tripping
// users up on a unit distinction that doesn't matter at this layer.
const UNIT_ALIASES: Record<string, SizeUnit> = {
  b: 'B',
  k: 'KiB', kb: 'KiB', kib: 'KiB',
  m: 'MiB', mb: 'MiB', mib: 'MiB',
  g: 'GiB', gb: 'GiB', gib: 'GiB',
  t: 'TiB', tb: 'TiB', tib: 'TiB',
}

export const parseSize = (s: string): Size => {
  const m = SIZE_RE.exec(s)
  if (!m) {
    throw new Error(`invalid size: ${JSON.stringify(s)} — expected a number with unit, e.g. "1GiB" or "512MiB"`)
  }
  const unit = UNIT_ALIASES[m[2]!.toLowerCase()]
  if (!unit) {
    throw new Error(`unknown size unit ${JSON.stringify(m[2])} in ${JSON.stringify(s)} — use B, KiB, MiB, GiB, or TiB`)
  }
  return { unit, value: Number(m[1]), sector_size: DEFAULT_SECTOR }
}

export const formatSize = (size: Size): string => `${size.value}${size.unit}`

export const UNIT_BYTES: Record<SizeUnit, number> = {
  B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
}

export const sizeBytes = (size: Size): number => size.value * UNIT_BYTES[size.unit]
