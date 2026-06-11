let currentDetail: string | null = null

export const getCurrentDetail = (): string | null => currentDetail
export const setCurrentDetail = (name: string | null): void => {
  currentDetail = name
}

let openDisk: string | null = null
export const getOpenDisk = (): string | null => openDisk
export const setOpenDisk = (device: string | null): void => {
  openDisk = device
}

// Which user detail panel is open, by index into the resolved users array.
// Keyed by index (not name) so live renames don't move the pointer. null = no
// panel, table only.
let openUser: number | null = null
export const getOpenUser = (): number | null => openUser
export const setOpenUser = (idx: number | null): void => {
  openUser = idx
}

// Transient error from the last partition mutation. Stored here (not thrown as
// HTTPException) so the UI can rerender with the prior valid state AND surface
// the message inline. Cleared on the next successful mutation or panel switch.
let diskError: string | null = null
export const getDiskError = (): string | null => diskError
export const setDiskError = (msg: string | null): void => {
  diskError = msg
}

export type InstallStatus = 'idle' | 'running' | 'success' | 'failure'
export type InstallState = {
  status: InstallStatus
  // 'dry-run' unless the server is running inside the archiso live environment
  // (/run/archiso/bootmnt present) — last-mile guard against wiping a real disk.
  mode: 'dry-run' | 'wet'
  device: string
  log: string
  exitCode: number | null
  startedAt: number | null
  finishedAt: number | null
}

let install: InstallState = {
  status: 'idle',
  mode: 'dry-run',
  device: '',
  log: '',
  exitCode: null,
  startedAt: null,
  finishedAt: null,
}

export const getInstall = (): InstallState => install
export const setInstall = (patch: Partial<InstallState>): void => {
  install = { ...install, ...patch }
}
export const appendInstallLog = (chunk: string): void => {
  install = { ...install, log: install.log + chunk }
}

export const CATEGORY_IDS = ['system', 'users', 'disk', 'pacman', 'boot', 'import'] as const
export type CategoryId = (typeof CATEGORY_IDS)[number]
