import { z } from 'zod'
import { Bootloader as BootloaderEnum, Kernel as KernelEnum, LocaleConfig } from '../config'

const LOADER_TO_BOOTLOADER = {
  'systemd-boot': 'Systemd-boot',
  grub: 'Grub',
  efistub: 'Efistub',
  limine: 'Limine',
  refind: 'Refind',
} as const satisfies Record<string, z.infer<typeof BootloaderEnum>>

const userFieldsShape = {
  username: z.string().min(1).max(32),
  sudo: z.boolean(),
  groups: z.string(),
} as const

const UserCreateFields = z.object({
  ...userFieldsShape,
  password: z.string().min(1, 'password required'),
})
const UserUpdateFields = z.object({
  ...userFieldsShape,
  password: z.string(),
})

export namespace Api {
  export const Locale = z
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

  export const Kernel = z.object({ kernel: KernelEnum })

  export const Hostname = z.object({ hostname: z.string().min(1).max(63) })

  export const Ntp = z.object({ ntp: z.boolean() })

  export const Swap = z.object({
    enabled: z.boolean(),
    algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']),
  })

  export const Bootloader = z
    .object({
      loader: z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind']),
      uki: z.boolean(),
      removable: z.boolean(),
    })
    .transform((v) => ({
      bootloader: LOADER_TO_BOOTLOADER[v.loader],
      uki: v.uki,
      removable: v.removable,
    }))

  export const Network = z.object({ mode: z.enum(['iso', 'nm']) })

  export const Timezone = z.object({ timezone: z.string().min(1) })

  export const RootPassword = z.object({ root_password: z.string() })

  export const UserFields = (prefix: string, mode: 'create' | 'update') =>
    z.preprocess((signals) => {
      const s = (signals ?? {}) as Record<string, unknown>
      return {
        username: s[`${prefix}_username`],
        sudo: s[`${prefix}_sudo`],
        groups: s[`${prefix}_groups`],
        password: s[`${prefix}_password`],
      }
    }, mode === 'create' ? UserCreateFields : UserUpdateFields)
}
