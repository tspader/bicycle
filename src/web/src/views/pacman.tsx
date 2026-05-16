import { Page } from './layout'
import { MirrorsSection } from './mirrors'
import { PackagesSection, type PackageList } from './packages'
import type { PackageDetail } from '../system'


export const PacmanView = ({ mirrors, packages }: {
  mirrors: { regions: string[]; selected: string[] }
  packages: {
    installed: string[]
    detail: PackageDetail | null
    selectedName: string | null
    initialPage: PackageList
  }
}) => (
  <Page heading="Pacman" subhead="Mirrors and packages.">
    <PackagesSection {...packages} />
    <MirrorsSection regions={mirrors.regions} selected={mirrors.selected} />
  </Page>
)
