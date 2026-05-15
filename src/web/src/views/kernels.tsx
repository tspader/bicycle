import { Layout, Page, Field } from './layout'
import { KERNELS, type Kernel } from '../data'

type Props = { selected: Kernel }

export const KernelsView = ({ selected }: Props) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ kernel: selected }),
  }
  return (
    <Layout active="kernels">
      <Page heading="Kernels" subhead="Which Linux kernel to install. Multiple are not supported here yet.">
        <form class="form" {...formAttrs}>
          <Field label="Kernel" htmlFor="kernel">
            <select id="kernel" class="combo" data-bind="kernel" data-on-change="@post('/api/kernels')">
              {KERNELS.map((k) => (
                <option value={k} selected={k === selected}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <p class="save-hint" data-text="'Saved · ' + $kernel" />
        </form>
      </Page>
    </Layout>
  )
}
