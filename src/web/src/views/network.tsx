import { Field, Section } from './layout'

const MODES = [
  { id: 'iso', label: 'Copy ISO config' },
  { id: 'nm', label: 'NetworkManager' },
] as const

export const NetworkSection = ({ mode }: { mode: (typeof MODES)[number]['id'] }) => (
  <Section title="Network" subhead="Networking backend in the installed system.">
    <form class="form" data-signals={JSON.stringify({ mode })}>
      <Field label="Mode" htmlFor="mode">
        <select id="mode" class="combo" data-bind="mode" data-on:change="@post('/api/network')">
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
