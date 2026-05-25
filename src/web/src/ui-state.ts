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
  // 'dry-run' unless the server was started with BICYCLE_WET=1 — this is the
  // last-mile guard against accidentally wiping a real disk during dev.
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

export type CategoryId = 'system' | 'users' | 'disk' | 'pacman' | 'boot'

