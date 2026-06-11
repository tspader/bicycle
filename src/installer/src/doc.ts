import { loadBicycleDoc, yamledit, type BicycleConfig } from '@bicycle/shared'

export type { YamlPath as Path } from '@bicycle/shared'

export const resolved = (text: string): BicycleConfig => {
  if (!text.trim()) return {}
  return loadBicycleDoc(text).resolved
}

export const { edit, node, setScalar, setNode, deleteAt, append, pruneEmpty } = yamledit
