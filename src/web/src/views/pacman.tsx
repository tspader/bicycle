import { Layout, Page } from './layout'
import { MirrorsSection } from './mirrors'
import { PackagesSection, type PackageList } from './packages'
import type { PackageDetail } from '../system'

type Props = {
  mirrors: { regions: string[]; selected: string[] }
  packages: {
    installed: string[]
    detail: PackageDetail | null
    selectedName: string | null
    initialPage: PackageList
  }
}

export const PacmanView = ({ mirrors, packages }: Props) => (
  <Layout active="pacman">
    <Page heading="Pacman" subhead="Mirrors and packages.">
      <MirrorsSection regions={mirrors.regions} selected={mirrors.selected} />
      <PackagesSection {...packages} />
    </Page>
  </Layout>
)
