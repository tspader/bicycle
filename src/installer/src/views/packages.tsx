import { z } from 'zod'
import { Page, rowClick } from './layout'
import type { PackageEntry, PackageDetail } from '../system'
import { bind, on, signals } from '../datastar'
import { routes } from '../routes'

export const packageSignals = signals(
  {
    q: z.string().default(''),
    repos: z.array(z.string()).default([]),
  },
  'pkg_',
)

type Props = {
  installed: string[]
  detail: PackageDetail | null
  selectedName: string | null
  initialPage: PackageList
  availableRepos: string[]
  selectedRepos: string[]
}

export type PackageList = { items: PackageEntry[]; next: string | null }

export type RowState = { checked: Set<string>; selectedName: string | null }

export const PackagesSection = ({ installed, detail, selectedName, initialPage, availableRepos, selectedRepos }: Props) => {
  const state: RowState = { checked: new Set(installed), selectedName }
  const selected = new Set(selectedRepos)
  return (
    <Page heading="Packages">
      <PackageDetailCard detail={detail} />

      <form class="form pkg-filters" {...packageSignals.seed({ q: '', repos: selectedRepos })}>
        <input
          class="combo"
          type="text"
          placeholder="Filter..."
          {...bind(packageSignals.$.q)}
          {...on('input', routes.packagesList.action({}), { debounceMs: 250 })}
        />
        <div class="repo-filter">
          {availableRepos.map((repo) => (
            <label class="toggle">
              <input
                type="checkbox"
                class="pkg-check"
                value={repo}
                checked={selected.has(repo)}
                {...bind(packageSignals.$.repos)}
                {...on('change', routes.packagesList.action({}))}
              />
              {repo}
            </label>
          ))}
        </div>
      </form>

      <PackageListPanel page={initialPage} state={state} />
    </Page>
  )
}

export const PackageRow = ({ p, isChecked, isSelected }: { p: PackageEntry; isChecked: boolean; isSelected: boolean }) => (
  <tr
    class={`row pkg-row${isSelected ? ' row-selected' : ''}`}
    id={`pkg-row-${p.name}`}
    {...on('click', rowClick(routes.packagesDetail.action({ name: p.name })))}
  >
    <td class="col-check">
      <input
        type="checkbox"
        class="pkg-check"
        checked={isChecked}
        {...on('change', routes.packagesToggle.action({ name: p.name }))}
      />
    </td>
    <td class="col-name">
      <span class="pkg-name">{p.name}</span>
    </td>
    <td class="col-repo">
      <span class="muted small"> {p.repo}</span>
    </td>
    <td class="col-version mono">{p.version}</td>
  </tr>
)

export const PackageRows = ({ items, state }: { items: PackageEntry[]; state: RowState }) => (
  <>
    {items.map((p) => (
      <PackageRow
        p={p}
        isChecked={state.checked.has(p.name)}
        isSelected={state.selectedName === p.name}
      />
    ))}
  </>
)

export const PackageMore = ({ next }: { next: string | null }) => (
  <div id="package-more">
    {next ? (
      <button
        type="button"
        class="btn"
        {...on('click', routes.packagesList.action({ after: next, mode: 'append' }))}
      >
        Load more
      </button>
    ) : (
      <p class="muted small">End of results.</p>
    )}
  </div>
)

export const PackageListPanel = ({ page, state }: { page: PackageList; state: RowState }) => (
  <div id="package-list" class="list">
    <table class="table pkg-table">
      <thead>
        <tr>
          <th class="col-check"></th>
          <th>Package</th>
          <th class="col-repo">Repo</th>
          <th class="col-version">Version</th>
        </tr>
      </thead>
      <tbody id="package-rows">
        <PackageRows items={page.items} state={state} />
      </tbody>
    </table>
    <PackageMore next={page.next} />
  </div>
)

export const PackageDetailCard = ({ detail }: { detail: PackageDetail | null }) => (
  <div id="package-detail" class="card">
    {detail ? (
      <div class="detail-split">
        <div>
          <h2 class="card-title">
            {detail.name}
            <span class="muted small">
              {detail.version}
            </span>
          </h2>
          <dl class="detail-fields">
            <dt>Repo</dt>
            <dd>{detail.repo}</dd>
            <dt>URL</dt>
            <dd>
              <a class="link" href={detail.url} target="_blank" rel="noreferrer">
                {detail.url}
              </a>
            </dd>
            <dt>Size</dt>
            <dd>{detail.installed_size}</dd>
            <dt>Depends</dt>
            <dd>{detail.depends.length}</dd>
            <dt>Description</dt>
            <dd>{detail.description}</dd>
          </dl>
        </div>
        <div class="detail-deps scroll-card">
          <div class="detail-deps-inner">
            <table class="table dep-table">
              <thead>
                <tr>
                  <th>Dependencies</th>
                </tr>
              </thead>
              <tbody>
                {detail.depends.length === 0 ? (
                  <tr>
                    <td class="muted">No dependencies</td>
                  </tr>
                ) : (
                  detail.depends.map((d) => (
                    <tr>
                      <td class="mono small">{d}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    ) : (
      <p class="muted">Click a package row to see details.</p>
    )}
  </div>
)
