import { z } from 'zod'
import { Field, Section, rowClick } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

type Props = { regions: string[]; selected: string[] }

export const mirrorSignals = signals({ q: z.string().default('') }, 'mir_')

const rowId = (s: string): string => `region-row-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export const MirrorsSection = ({ regions, selected }: Props) => {
  const set = new Set(selected)
  return (
    <Section
      title="Mirrors"
      subhead="Pacman mirror regions. Archinstall fetches and ranks at install time."
    >
      <form class="form" {...mirrorSignals.seed({ q: '' })}>
        <Field label="Search" htmlFor="region-q">
          <input
            id="region-q"
            class="combo"
            type="text"
            placeholder="Filter..."
            {...bind(mirrorSignals.$.q)}
            {...on('input', routes.mirrorsList.action(), { debounceMs: 250 })}
          />
        </Field>
      </form>
      <div class="region-scroll scroll-card">
        <RegionList items={regions} checked={set} />
      </div>
    </Section>
  )
}

export const RegionRow = ({ name, isChecked }: { name: string; isChecked: boolean }) => (
  <tr
    class="row mir-row"
    id={rowId(name)}
    {...on('click', rowClick(routes.mirrorsToggle.action({ name })))}
  >
    <td class="col-check">
      <input
        type="checkbox"
        class="pkg-check"
        checked={isChecked}
        {...on('change', routes.mirrorsToggle.action({ name }))}
      />
    </td>
    <td>{name}</td>
  </tr>
)

export const RegionList = ({ items, checked }: { items: string[]; checked: Set<string> }) => (
  <div id="region-list">
    <table class="table pkg-table mir-table">
      <tbody>
        {items.map((r) => (
          <RegionRow name={r} isChecked={checked.has(r)} />
        ))}
      </tbody>
    </table>
  </div>
)
