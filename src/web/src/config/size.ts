import { z } from 'zod'

export const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'Percent'] as const
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

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|%)$/

export const parseSize = (s: string): Size => {
  if (s === 'rest') return { unit: 'Percent', value: 100, sector_size: DEFAULT_SECTOR }
  const m = SIZE_RE.exec(s.trim())
  if (!m) throw new Error(`invalid size: ${JSON.stringify(s)}`)
  const value = Number(m[1])
  const unit = m[2] === '%' ? 'Percent' : (m[2] as SizeUnit)
  return { unit, value, sector_size: DEFAULT_SECTOR }
}

export const formatSize = (size: Size, opts: { isLast?: boolean } = {}): string => {
  if (size.unit === 'Percent' && size.value === 100) return 'rest'
  if (size.unit === 'B' && opts.isLast) return 'rest'
  if (size.unit === 'Percent') return `${size.value}%`
  return `${size.value}${size.unit}`
}
