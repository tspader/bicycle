import { Field, Section } from './layout'
import { KERNELS, type Kernel } from '../system'

export const KernelsSection = ({ selected }: { selected: Kernel }) => (
  <Section id="kernels" title="Kernels" subhead="Which Linux kernel to install. Multiple are not supported here yet.">
    <form class="form" data-signals={JSON.stringify({ kernel: selected })}>
      <Field label="Kernel" htmlFor="kernel">
        <select id="kernel" class="combo" data-bind="kernel" data-on:change="@post('/api/kernels')">
          {KERNELS.map((k) => (
            <option value={k} selected={k === selected}>
              {k}
            </option>
          ))}
        </select>
      </Field>
    </form>
  </Section>
)
