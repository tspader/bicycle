import { Field, Section } from './layout'

type Props = { value: string; zones: string[]; ntp: boolean }

export const TimeSection = ({ value, zones, ntp }: Props) => (
  <Section id="time" title="Time" subhead="Time zone and clock sync.">
    <form class="form" data-signals={JSON.stringify({ timezone: value })}>
      <Field label="Zone" htmlFor="timezone">
        <select
          id="timezone"
          class="combo"
          data-bind="timezone"
          data-on:change="@post('/api/timezone')"
        >
          {zones.map((z) => (
            <option value={z} selected={z === value}>
              {z}
            </option>
          ))}
        </select>
      </Field>
    </form>
    <form class="form" data-signals={JSON.stringify({ ntp })}>
      <Field label="NTP" htmlFor="ntp">
        <label class="toggle">
          <input
            id="ntp"
            type="checkbox"
            data-bind="ntp"
            data-on:change="@post('/api/ntp')"
            checked={ntp}
          />
          <span data-text="$ntp ? 'On' : 'Off'" />
        </label>
      </Field>
    </form>
  </Section>
)
