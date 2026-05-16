import { Layout, Page, Section } from './layout'
import { SwapSection } from './swap'

type Props = {
  swap: { enabled: boolean; algorithm: 'zstd' | 'lzo-rle' | 'lzo' | 'lz4' | 'lz4hc' }
}

export const DiskView = ({ swap }: Props) => (
  <Layout active="disk">
    <Page heading="Disk" subhead="Partitioning and swap.">
      <Section id="partitions" title="Partitions" subhead="Disk layout.">
        <p class="empty">Not yet implemented.</p>
      </Section>
      <SwapSection enabled={swap.enabled} algorithm={swap.algorithm} />
    </Page>
  </Layout>
)
