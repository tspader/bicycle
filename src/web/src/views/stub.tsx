import { Layout, Page, CATEGORIES, type CategoryId } from './layout'

export const StubView = ({ id }: { id: CategoryId }) => {
  const label = CATEGORIES.find((c) => c.id === id)?.label ?? id
  return (
    <Layout active={id}>
      <Page heading={label} subhead="Not yet implemented.">
        <p class="empty">This section is stubbed. Pick Locale or Kernels for now.</p>
      </Page>
    </Layout>
  )
}
