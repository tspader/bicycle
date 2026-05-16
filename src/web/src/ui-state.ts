let currentDetail: string | null = null

export const getCurrentDetail = (): string | null => currentDetail
export const setCurrentDetail = (name: string | null): void => {
  currentDetail = name
}
