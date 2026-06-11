import { getConfig, editDelete, editPrune, editAppend } from '../state'
import { searchPackages, packageDetail, loadPackages } from '../system'
import { getCurrentDetail, setCurrentDetail } from '../ui-state'
import {
  PackageListPanel,
  PackageRows,
  PackageRow,
  PackageMore,
  PackageDetailCard,
  packageSignals,
} from '../views/packages'
import type { AppContext } from '../http'
import { routes } from '../routes'
import { sse, patch, patchSidecar, flatPackages } from '../render'

export const toggle = async (c: AppContext) => {
  const { name } = routes.packagesToggle.params(c)
  const pkgs = getConfig().packages ?? {}
  let group: string | null = null
  let gIdx = -1
  for (const [repo, list] of Object.entries(pkgs)) {
    const i = list.indexOf(name)
    if (i >= 0) { group = repo; gIdx = i; break }
  }
  if (group) {
    editDelete(['packages', group, gIdx])
    editPrune(['packages', group])
    editPrune(['packages'])
  } else {
    const all = await loadPackages()
    const repo = all.find((p) => p.name === name)?.repo ?? 'extra'
    editAppend(['packages', repo], name)
  }

  const all = await loadPackages()
  const entry = all.find((p) => p.name === name)
  const showDetail = getCurrentDetail() === name
  const detail = showDetail ? await packageDetail(name) : null
  return patchSidecar(
    entry && <PackageRow p={entry} isChecked={!group} isSelected={showDetail} />,
    detail && <PackageDetailCard detail={detail} />,
  )
}

export const list = async (c: AppContext) => {
  const { after, mode } = routes.packagesList.params(c)
  const { q, repos } = packageSignals.read(c)
  const installed = flatPackages(getConfig())
  const state = { checked: new Set(installed), selectedName: getCurrentDetail() }
  const page = await searchPackages({ q, repos, after, selected: state.checked })
  return sse((stream) => {
    if (mode === 'append') {
      stream.html(<PackageRows items={page.items} state={state} />, {
        selector: '#package-rows',
        mode: 'append',
      })
      stream.html(<PackageMore next={page.next} />)
    } else {
      stream.html(<PackageListPanel page={{ items: page.items, next: page.next }} state={state} />)
    }
  })
}

export const detail = async (c: AppContext) => {
  const { name } = routes.packagesDetail.params(c)
  const prev = getCurrentDetail()
  const det = await packageDetail(name)
  setCurrentDetail(det ? name : null)
  const checked = new Set(flatPackages(getConfig()))
  const all = await loadPackages()
  const prevEntry = prev && prev !== name ? all.find((p) => p.name === prev) : null
  const cur = det ? all.find((p) => p.name === name) : null
  return patch(
    prevEntry && <PackageRow p={prevEntry} isChecked={checked.has(prevEntry.name)} isSelected={false} />,
    cur && <PackageRow p={cur} isChecked={checked.has(name)} isSelected={true} />,
    <PackageDetailCard detail={det} />,
  )
}
