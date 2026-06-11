import type { Child } from 'hono/jsx'
import { PacmanView } from '../views/pacman'
import { packageSignals } from '../views/packages'
import { regions, searchPackages, availableRepos } from '../system'
import { setCurrentDetail } from '../ui-state'
import type { AppContext } from '@bicycle/datastar'
import { configState, flatPackages } from '../render'

export const pacmanBody = async (c: AppContext): Promise<Child> => {
  const { bike } = configState()
  const { q, repos: reposSig } = packageSignals.peek(c)
  const installed = flatPackages(bike)
  const selected = bike.pacman?.mirrors?.regions ?? []
  const allRepos = await availableRepos()
  const repos = reposSig.length === 0 ? allRepos : reposSig
  const page = await searchPackages({ q, repos, selected: new Set(installed) })
  setCurrentDetail(null)
  return (
    <PacmanView
      mirrors={{ regions: regions(), selected }}
      packages={{
        installed, detail: null, selectedName: null,
        initialPage: { items: page.items, next: page.next },
        availableRepos: allRepos, selectedRepos: repos,
      }}
    />
  )
}
