import { Field, Section } from './layout'

export const HostnameSection = ({ value }: { value: string }) => (
  <Section id="hostname" title="Hostname" subhead="System hostname.">
    <form class="form" data-signals={JSON.stringify({ hostname: value })}>
      <Field label="Hostname" htmlFor="hostname">
        <input
          id="hostname"
          class="combo"
          type="text"
          data-bind="hostname"
          data-on:change="@post('/api/hostname')"
          value={value}
        />
      </Field>
    </form>
  </Section>
)
