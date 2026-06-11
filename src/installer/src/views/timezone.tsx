import { z } from 'zod'
import { Field, Section, Switch } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

export const timezoneSignals = signals({
  timezone: z.string().min(1),
})

export const ntpSignals = signals({
  ntp: z.boolean(),
})

type Props = { value: string; zones: string[]; ntp: boolean }

export const TimeSection = ({ value, zones, ntp }: Props) => (
  <Section title="Time" subhead="Time zone and clock sync.">
    <form class="form" {...timezoneSignals.seed({ timezone: value })}>
      <Field label="Zone" htmlFor="timezone">
        <select
          id="timezone"
          class="combo"
          {...bind(timezoneSignals.$.timezone)}
          {...on('change', routes.timezone.action())}
        >
          {zones.map((z) => (
            <option value={z} selected={z === value}>
              {z}
            </option>
          ))}
        </select>
      </Field>
    </form>
    <form class="form" {...ntpSignals.seed({ ntp })}>
      <Field label="NTP" htmlFor="ntp">
        <Switch id="ntp" sig={ntpSignals.$.ntp} checked={ntp} action={routes.ntp.action()} />
      </Field>
    </form>
  </Section>
)
