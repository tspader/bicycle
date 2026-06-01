import { getConfig, editDelete, editPrune, editAppend } from '../state'
import { regions } from '../system'
import { RegionListFragment, RegionRowFragment } from '../views/mirrors'
import { type AppContext, getSignal, requiredQuery } from '../http'
import { patch, patchSidecar } from '../render'

export const toggle = (c: AppContext) => {
  const name = requiredQuery(c, 'name')
  const current = getConfig().pacman?.mirrors?.regions ?? []
  const idx = current.indexOf(name)
  if (idx >= 0) {
    editDelete(['pacman', 'mirrors', 'regions', idx])
    editPrune(['pacman', 'mirrors', 'regions'])
    editPrune(['pacman', 'mirrors'])
    editPrune(['pacman'])
  } else {
    editAppend(['pacman', 'mirrors', 'regions'], name)
  }
  return patchSidecar(<RegionRowFragment name={name} isChecked={idx < 0} />)
}

export const list = (c: AppContext) => {
  const needle = getSignal(c, 'q').trim().toLowerCase()
  const all = regions()
  const filtered = needle ? all.filter((name) => name.toLowerCase().includes(needle)) : all
  const checked = new Set(getConfig().pacman?.mirrors?.regions ?? [])
  return patch(<RegionListFragment items={filtered} checked={checked} />)
}
