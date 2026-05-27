import { z } from 'zod'

export const AgeIdentityString = z.string()
  .transform((s) => s.trim())
  .refine((s) => /^[\x20-\x7E]+$/.test(s), { message: 'identity must be ASCII' })
  .refine((s) => s.length > 50, { message: 'identity is too short' })
  .refine(
    (s) => s.startsWith('AGE-SECRET-KEY-1') || s.startsWith('AGE-SECRET-KEY-PQ-1'),
    { message: 'identity must start with AGE-SECRET-KEY-1 or AGE-SECRET-KEY-PQ-1' },
  )
