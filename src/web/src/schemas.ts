import { z } from 'zod'
import { LocaleConfig, Kernel } from './config'

export const LocaleSchema = z
  .object({
    kbLayout: z.string().min(1),
    sysLang: z.string().min(1),
    sysEnc: z.string().min(1),
  })
  .transform((v): z.infer<typeof LocaleConfig> => ({
    kb_layout: v.kbLayout,
    sys_lang: v.sysLang,
    sys_enc: v.sysEnc,
  }))

export const KernelsSchema = z.object({
  kernel: Kernel,
})
