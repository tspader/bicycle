let currentDetail: string | null = null

export const getCurrentDetail = (): string | null => currentDetail
export const setCurrentDetail = (name: string | null): void => {
  currentDetail = name
}

let selectedPartObjId: string | null = null

export const getSelectedPart = (): string | null => selectedPartObjId
export const setSelectedPart = (id: string | null): void => {
  selectedPartObjId = id
}

export type CategoryId = 'system' | 'users' | 'disk' | 'pacman' | 'boot'

