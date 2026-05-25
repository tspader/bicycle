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

export type CategoryId = 'system' | 'users' | 'disk' | 'pacman' | 'boot'

