import { z } from 'zod'
import { Section } from './layout'
import { bind, on, signals } from '@bicycle/datastar'
import { routes } from '../routes'

type Props = { regions: string[]; selected: string[] }

export const mirrorSignals = signals({ q: z.string().default('') }, 'mir_')

const itemId = (s: string): string => `region-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export const MirrorsSection = ({ regions, selected }: Props) => {
  const set = new Set(selected)
  return (
    <Section
      title="Mirrors"
      subhead="Pacman mirror regions. Archinstall fetches and ranks at install time."
    >
      <div class="card form" {...mirrorSignals.seed({ q: '' })}>
        <input
          class="combo"
          type="text"
          placeholder="Filter regions..."
          {...bind(mirrorSignals.$.q)}
          {...on('input', routes.mirrorsList.action(), { debounceMs: 250 })}
        />
        <RegionList items={regions} checked={set} />
      </div>
    </Section>
  )
}

export const RegionItem = ({ name, isChecked }: { name: string; isChecked: boolean }) => (
  <label class="region-item" id={itemId(name)}>
    <input
      type="checkbox"
      class="pkg-check"
      checked={isChecked}
      {...on('change', routes.mirrorsToggle.action({ name }))}
    />
    {name}
  </label>
)

export const RegionList = ({ items, checked }: { items: string[]; checked: Set<string> }) => (
  <div id="region-list" class="region-grid">
    {items.length === 0 ? (
      <p class="muted small">No regions match.</p>
    ) : (
      items.map((r) => <RegionItem name={r} isChecked={checked.has(r)} />)
    )}
  </div>
)
