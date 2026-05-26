import type { ArchinstallConfig } from './config'

let state: ArchinstallConfig = {
  hostname: 'bicycle-test',
  kernels: ['linux'],
  ntp: true,
  locale_config: { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' },
  bootloader_config: { bootloader: 'Systemd-boot', uki: true, removable: false },
  swap: { enabled: true, algorithm: 'zstd' },
  network_config: { type: 'iso' },
  timezone: 'UTC',
  packages: [],
  users: [],
  mirror_config: {
    mirror_regions: {},
    custom_servers: [],
    custom_repositories: [],
    optional_repositories: [],
  },
  root_enc_password: null,
}

export const getState = (): Readonly<ArchinstallConfig> => state

export const setState = (patch: Partial<ArchinstallConfig>): void => {
  state = { ...state, ...patch }
}
