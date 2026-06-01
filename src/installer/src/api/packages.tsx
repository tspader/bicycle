import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { getConfig, editDelete, editPrune, editAppend } from '../state'
import { searchPackages, packageDetail, loadPackages } from '../system'
import { getCurrentDetail, setCurrentDetail } from '../ui-state'
import {
  PackageList as PackageListFragment,
  PackageRowsFragment,
  PackageRowFragment,
  PackageMore,
  PackageDetailFragment,
} from '../views/packages'
import { type AppContext, getSignal, requiredQuery } from '../http'
import { patch, patchSidecar, flatPackages } from '../render'

export const toggle = async (c: AppContext) => {
  const name = requiredQuery(c, 'name')
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
    entry && <PackageRowFragment p={entry} isChecked={!group} isSelected={showDetail} />,
    detail && <PackageDetailFragment detail={detail} />,
  )
}

export const list = async (c: AppContext) => {
  const after = c.req.query('after') ?? ''
  const mode = c.req.query('mode') ?? 'outer'
  const installed = flatPackages(getConfig())
  const state = { checked: new Set(installed), selectedName: getCurrentDetail() }
  const page = await searchPackages({
    q: getSignal(c, 'q'),
    repos: getSignal(c, 'repos'),
    after,
    selected: state.checked,
  })
  return ServerSentEventGenerator.stream((stream) => {
    if (mode === 'append') {
      const rows = (<PackageRowsFragment items={page.items} state={state} />).toString()
      stream.patchElements(rows, { selector: '#package-list', mode: 'append' as never })
      stream.patchElements((<PackageMore next={page.next} />).toString())
    } else {
      const html = (<PackageListFragment page={{ items: page.items, next: page.next }} state={state} />).toString()
      stream.patchElements(`<div id="package-list" class="list">${html}</div>`)
    }
  })
}

export const detail = async (c: AppContext) => {
  const name = requiredQuery(c, 'name')
  const prev = getCurrentDetail()
  const det = await packageDetail(name)
  setCurrentDetail(det ? name : null)
  const checked = new Set(flatPackages(getConfig()))
  const all = await loadPackages()
  const prevEntry = prev && prev !== name ? all.find((p) => p.name === prev) : null
  const cur = det ? all.find((p) => p.name === name) : null
  return patch(
    prevEntry && <PackageRowFragment p={prevEntry} isChecked={checked.has(prevEntry.name)} isSelected={false} />,
    cur && <PackageRowFragment p={cur} isChecked={checked.has(name)} isSelected={true} />,
    <PackageDetailFragment detail={det} />,
  )
}
