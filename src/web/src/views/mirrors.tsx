import { Layout, Page, Field } from './layout'

type Props = { regions: string[]; selected: string[] }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export const MirrorsView = ({ regions, selected }: Props) => {
  const set = new Set(selected)
  return (
    <Layout active="mirrors">
      <Page heading="Mirrors" subhead="Pacman mirror regions. Archinstall fetches and ranks at install time.">
        <Field label="Regions" hint="Region names must match archlinux.org's country list.">
          <div id="region-list" class="checklist">
            {regions.map((r) => (
              <label class="checkrow" for={`region-${slug(r)}`}>
                <input
                  id={`region-${slug(r)}`}
                  type="checkbox"
                  checked={set.has(r)}
                  data-on-change={`@post('/api/mirrors/toggle?name=${encodeURIComponent(r)}')`}
                />
                <span>{r}</span>
              </label>
            ))}
          </div>
        </Field>
      </Page>
    </Layout>
  )
}
