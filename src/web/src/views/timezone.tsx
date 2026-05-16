import { Layout, Page, Field } from './layout'

type Props = { value: string; zones: string[] }

export const TimezoneView = ({ value, zones }: Props) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ timezone: value }),
  }
  return (
    <Layout active="timezone">
      <Page heading="Timezone" subhead="System time zone.">
        <form class="form" {...formAttrs}>
          <Field label="Zone" htmlFor="timezone">
            <select
              id="timezone"
              class="combo"
              data-bind="timezone"
              data-on-change="@post('/api/timezone')"
            >
              {zones.map((z) => (
                <option value={z} selected={z === value}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
          <p class="save-hint" data-text="'Saved · ' + $timezone" />
        </form>
      </Page>
    </Layout>
  )
}
