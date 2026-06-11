import { Field, Section } from './layout'
import { KERNELS, type Kernel } from '../system'
import { Kernel as KernelEnum } from '../config'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

export const kernelSignals = signals({
  kernel: KernelEnum,
})

export const KernelsSection = ({ selected }: { selected: Kernel }) => (
  <Section title="Kernels" subhead="Which Linux kernel to install. Multiple are not supported here yet.">
    <form class="form" {...kernelSignals.seed({ kernel: selected })}>
      <Field label="Kernel" htmlFor="kernel">
        <select
          id="kernel"
          class="combo"
          {...bind(kernelSignals.$.kernel)}
          {...on('change', routes.kernels.action())}
        >
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
