import { Layout, Page } from './layout'
import { HostnameSection } from './hostname'
import { LocaleSection } from './locale'
import { TimeSection } from './timezone'
import { NetworkSection } from './network'
import type { LocaleConfig } from '../config'

type Props = {
  hostname: string
  locale: {
    state: LocaleConfig
    kbLayouts: string[]
    languages: string[]
    encodings: string[]
  }
  time: { zone: string; zones: string[]; ntp: boolean }
  network: { mode: 'iso' | 'nm' | 'nm_iwd' | 'manual' }
}

export const SystemView = ({ hostname, locale, time, network }: Props) => (
  <Layout active="system">
    <Page heading="System" subhead="Hostname, locale, time, and network.">
      <HostnameSection value={hostname} />
      <LocaleSection {...locale} />
      <TimeSection value={time.zone} zones={time.zones} ntp={time.ntp} />
      <NetworkSection mode={network.mode} />
    </Page>
  </Layout>
)
