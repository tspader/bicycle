import { Layout, Page, Field } from './layout'

export const NtpView = ({ enabled }: { enabled: boolean }) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ ntp: enabled }),
  }
  return (
    <Layout active="ntp">
      <Page heading="NTP" subhead="Sync time post-install with systemd-timesyncd.">
        <form class="form" {...formAttrs}>
          <Field label="Enabled" htmlFor="ntp">
            <label class="toggle">
              <input
                id="ntp"
                type="checkbox"
                data-bind="ntp"
                data-on-change="@post('/api/ntp')"
                checked={enabled}
              />
              <span data-text="$ntp ? 'On' : 'Off'" />
            </label>
          </Field>
          <p class="save-hint" data-text="'Saved · ' + ($ntp ? 'on' : 'off')" />
        </form>
      </Page>
    </Layout>
  )
}
