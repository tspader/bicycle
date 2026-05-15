import type { ArchinstallConfig } from './config'

let state: ArchinstallConfig = {
  hostname: 'bicycle-test',
  kernels: ['linux'],
  locale_config: { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' },
}

export const getState = (): Readonly<ArchinstallConfig> => state

export const setState = (patch: Partial<ArchinstallConfig>): void => {
  state = { ...state, ...patch }
}
