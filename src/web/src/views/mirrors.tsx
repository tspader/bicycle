import { Layout, Page, Field } from './layout'

type Props = { regions: string[]; selected: string[] }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export const MirrorsView = ({ regions, selected }: Props) => {
  const set = new Set(selected)
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ q: '' }),
  }
  return (
    <Layout active="mirrors">
      <Page heading="Mirrors" subhead="Pacman mirror regions. Archinstall fetches and ranks at install time.">
        <form class="form" {...formAttrs}>
          <Field label="Search" htmlFor="region-q">
            <input
              id="region-q"
              class="combo"
              type="text"
              placeholder="Filter..."
              data-bind="q"
              {...{ 'data-on-input__debounce.250ms': "@get('/api/mirrors/list')" }}
            />
          </Field>
        </form>
        <div class="region-scroll">
          <div id="region-list">
            <RegionRows items={regions} checked={set} />
          </div>
        </div>
      </Page>
    </Layout>
  )
}

const RegionRow = ({ name, isChecked }: { name: string; isChecked: boolean }) => {
  const toggleUrl = `/api/mirrors/toggle?name=${encodeURIComponent(name)}`
  return (
    <tr
      class="row mir-row"
      id={`region-row-${slug(name)}`}
      data-on-click={`if(evt.target.closest('input')) return; @post('${toggleUrl}')`}
    >
      <td class="col-check">
        <input
          type="checkbox"
          class="pkg-check"
          checked={isChecked}
          data-on-change={`@post('${toggleUrl}')`}
        />
      </td>
      <td>{name}</td>
    </tr>
  )
}

const RegionRows = ({ items, checked }: { items: string[]; checked: Set<string> }) => (
  <table class="table pkg-table mir-table">
    <tbody>
      {items.map((r) => (
        <RegionRow name={r} isChecked={checked.has(r)} />
      ))}
    </tbody>
  </table>
)

export const RegionListFragment = ({ items, checked }: { items: string[]; checked: Set<string> }) => (
  <div id="region-list">
    <RegionRows items={items} checked={checked} />
  </div>
)

export const RegionRowFragment = ({ name, isChecked }: { name: string; isChecked: boolean }) => (
  <RegionRow name={name} isChecked={isChecked} />
)
