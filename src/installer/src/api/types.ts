import { z } from 'zod'
import { Kernel as KernelEnum } from '../config'

// Signal schemas for the simple field-edit routes. These validate datastar
// signals straight into the shapes written to bicycle.yml — there is no
// archinstall projection here (that's derived later from the resolved config).
export namespace Api {
  export const Locale = z.object({
    kbLayout: z.string().min(1),
    sysLang: z.string().min(1),
    sysEnc: z.string().min(1),
  })

  export const Kernel = z.object({ kernel: KernelEnum })

  export const Hostname = z.object({ hostname: z.string().min(1).max(63) })

  export const Ntp = z.object({ ntp: z.boolean() })

  export const Swap = z.object({
    enabled: z.boolean(),
    algorithm: z.enum(['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc']),
  })

  export const Bootloader = z.object({
    loader: z.enum(['systemd-boot', 'grub', 'efistub', 'limine', 'refind']),
    uki: z.boolean(),
    removable: z.boolean(),
  })

  export const Network = z.object({ mode: z.enum(['iso', 'nm']) })

  export const Timezone = z.object({ timezone: z.string().min(1) })

  export const RootPassword = z.object({ root_password: z.string() })
}
