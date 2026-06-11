import { z } from 'zod'
import { Field, Section, onOff } from './layout'
import { bind, on, signals } from '../datastar'
import { routes } from '../routes'

const ALGORITHMS = ['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc'] as const

export const swapSignals = signals({
  enabled: z.boolean(),
  algorithm: z.enum(ALGORITHMS),
})

type Props = { enabled: boolean; algorithm: (typeof ALGORITHMS)[number] }

export const SwapSection = ({ enabled, algorithm }: Props) => (
  <Section title="Swap" subhead="zram swap configuration.">
    <form class="form" {...swapSignals.seed({ enabled, algorithm })}>
      <Field label="Enabled" htmlFor="enabled">
        <label class="toggle">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            {...bind(swapSignals.$.enabled)}
            {...on('change', routes.swap.action())}
          />
          <span {...onOff(swapSignals.$.enabled)} />
        </label>
      </Field>
      <Field label="Algorithm" htmlFor="algorithm">
        <select
          id="algorithm"
          class="combo"
          {...bind(swapSignals.$.algorithm)}
          {...on('change', routes.swap.action())}
        >
          {ALGORITHMS.map((a) => (
            <option value={a} selected={a === algorithm}>
              {a}
            </option>
          ))}
        </select>
      </Field>
    </form>
  </Section>
)
