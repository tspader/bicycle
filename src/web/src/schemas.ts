import { z } from 'zod'
import { KERNELS } from './data'

export const LocaleSchema = z
  .object({
    kbLayout: z.string().min(1),
    sysLang: z.string().min(1),
    sysEnc: z.string().min(1),
  })
  .transform((v) => ({
    kb_layout: v.kbLayout,
    sys_lang: v.sysLang,
    sys_enc: v.sysEnc,
  }))

export const KernelsSchema = z.object({
  kernel: z.enum(KERNELS),
})
