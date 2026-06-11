import { z } from 'zod'
import { Field, Section } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

export const hostnameSignals = signals({
  hostname: z.string().min(1).max(63),
})

export const HostnameSection = ({ value }: { value: string }) => (
  <Section title="Hostname" subhead="System hostname.">
    <form class="form" {...hostnameSignals.seed({ hostname: value })}>
      <Field label="Hostname" htmlFor="hostname">
        <input
          id="hostname"
          class="combo"
          type="text"
          value={value}
          {...bind(hostnameSignals.$.hostname)}
          {...on('change', routes.hostname.action())}
        />
      </Field>
    </form>
  </Section>
)
