import { Layout, Page, Field } from './layout'

export const HostnameView = ({ value }: { value: string }) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ hostname: value }),
  }
  return (
    <Layout active="hostname">
      <Page heading="Hostname" subhead="System hostname.">
        <form class="form" {...formAttrs}>
          <Field label="Hostname" htmlFor="hostname" hint="Letters, digits, and hyphens.">
            <input
              id="hostname"
              class="combo"
              type="text"
              data-bind="hostname"
              data-on-change="@post('/api/hostname')"
              value={value}
            />
          </Field>
          <p class="save-hint" data-text="'Saved · ' + $hostname" />
        </form>
      </Page>
    </Layout>
  )
}
