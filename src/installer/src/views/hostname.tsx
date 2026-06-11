import { z } from 'zod'
import { Field, Section } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

export const hostnameSignals = signals({
  hostname: z.string().trim().max(63).default(''),
})

export const HostnameStatus = ({ status }: { status: string }) => (
  <p id="hostname-status" class="field-msg warn small">{status}</p>
)

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
          {...on('input', routes.hostname.action(), { debounceMs: 400 })}
        />
        <HostnameStatus status="" />
      </Field>
    </form>
  </Section>
)
