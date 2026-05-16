import { Layout, Page, Field } from './layout'

const ALGORITHMS = ['zstd', 'lzo-rle', 'lzo', 'lz4', 'lz4hc'] as const

type Props = { enabled: boolean; algorithm: (typeof ALGORITHMS)[number] }

export const SwapView = ({ enabled, algorithm }: Props) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ enabled, algorithm }),
  }
  return (
    <Layout active="swap">
      <Page heading="Swap" subhead="zram swap configuration.">
        <form class="form" {...formAttrs}>
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
      </Page>
    </Layout>
  )
}
