import { Field, Section } from './layout'

const MODES = [
  { id: 'iso', label: 'Copy ISO config' },
  { id: 'nm', label: 'NetworkManager' },
  { id: 'nm_iwd', label: 'NetworkManager (iwd)' },
  { id: 'manual', label: 'Manual (not yet)' },
] as const

export const NetworkSection = ({ mode }: { mode: (typeof MODES)[number]['id'] }) => (
  <Section id="network" title="Network" subhead="Networking backend in the installed system.">
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
      <p class="save-hint" data-text="'Saved · ' + $mode" />
    </form>
  </Section>
)
