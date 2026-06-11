import { z } from 'zod'
import { Field, Section } from './layout'
import { bind, on, signals } from '../datastar'
import { routes } from '../routes'

const MODES = [
  { id: 'iso', label: 'Copy ISO config' },
  { id: 'nm', label: 'NetworkManager' },
] as const

export const networkSignals = signals({
  mode: z.enum(['iso', 'nm']),
})

export const NetworkSection = ({ mode }: { mode: (typeof MODES)[number]['id'] }) => (
  <Section title="Network" subhead="Networking backend in the installed system.">
    <form class="form" {...networkSignals.seed({ mode })}>
      <Field label="Mode" htmlFor="mode">
        <select
          id="mode"
          class="combo"
          {...bind(networkSignals.$.mode)}
          {...on('change', routes.network.action())}
        >
          {MODES.map((m) => (
            <option value={m.id} selected={m.id === mode}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
    </form>
  </Section>
)
