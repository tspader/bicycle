import { KERNELS, type Kernel } from './data'

export type LocaleState = {
  kb_layout: string
  sys_lang: string
  sys_enc: string
}

export type InstallerState = {
  locale: LocaleState
  kernels: Kernel[]
  hostname: string
}

export const state: InstallerState = {
  locale: { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' },
  kernels: [KERNELS[0]],
  hostname: 'bicycle-test',
}
