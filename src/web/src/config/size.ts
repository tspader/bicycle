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

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)$/

export const parseSize = (s: string): Size => {
  const m = SIZE_RE.exec(s.trim())
  if (!m) throw new Error(`invalid size: ${JSON.stringify(s)}`)
  return { unit: m[2] as SizeUnit, value: Number(m[1]), sector_size: DEFAULT_SECTOR }
}

export const formatSize = (size: Size): string => `${size.value}${size.unit}`

export const UNIT_BYTES: Record<SizeUnit, number> = {
  B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4,
}

export const sizeBytes = (size: Size): number => size.value * UNIT_BYTES[size.unit]
