import { Field, Section } from './layout'

const ALGORITHMS = ['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc'] as const

type Props = { enabled: boolean; algorithm: (typeof ALGORITHMS)[number] }

export const SwapSection = ({ enabled, algorithm }: Props) => (
  <Section id="swap" title="Swap" subhead="zram swap configuration.">
    <form class="form" data-signals={JSON.stringify({ enabled, algorithm })}>
      <Field label="Enabled" htmlFor="enabled">
        <label class="toggle">
          <input
            id="enabled"
            type="checkbox"
            data-bind="enabled"
            data-on-change="@post('/api/swap')"
            checked={enabled}
          />
          <span data-text="$enabled ? 'On' : 'Off'" />
        </label>
      </Field>
      <Field label="Algorithm" htmlFor="algorithm">
        <select
          id="algorithm"
          class="combo"
          data-bind="algorithm"
          data-on-change="@post('/api/swap')"
        >
          {ALGORITHMS.map((a) => (
            <option value={a} selected={a === algorithm}>
              {a}
            </option>
          ))}
        </select>
      </Field>
      <p class="save-hint" data-text="'Saved · ' + ($enabled ? $algorithm : 'off')" />
    </form>
  </Section>
)
