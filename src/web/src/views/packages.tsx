import { Layout, Page, Field } from './layout'
import type { PackageEntry, PackageDetail } from '../system'

type Props = {
  installed: string[]
  detail: PackageDetail | null
  selectedName: string | null
  initialPage: PackageList
}

export type PackageList = { items: PackageEntry[]; next: string | null; q: string }

export type RowState = { checked: Set<string>; selectedName: string | null }

export const PackagesView = ({ installed, detail, selectedName, initialPage }: Props) => {
  const formAttrs: Record<string, string> = {
    'data-signals': JSON.stringify({ q: initialPage.q }),
  }
  const state: RowState = { checked: new Set(installed), selectedName }
  return (
    <Layout active="packages">
      <Page heading="Packages" subhead="Additional packages to install.">
        <div id="package-detail" class="card">
          <PackageDetailPanel detail={detail} />
        </div>
        <form class="form" {...formAttrs}>
          <Field label="Search" htmlFor="q">
            <input
              id="q"
              class="combo"
              type="text"
              placeholder="Filter..."
              data-bind="q"
              {...{ 'data-on-input__debounce.250ms': "@get('/api/packages/list')" }}
            />
          </Field>
        </form>
        <div id="package-list" class="list">
          <PackageList page={initialPage} state={state} />
        </div>
      </Page>
    </Layout>
  )
}

const PackageRow = ({ p, isChecked, isSelected }: { p: PackageEntry; isChecked: boolean; isSelected: boolean }) => {
  const detailUrl = `/api/packages/detail?name=${encodeURIComponent(p.name)}`
  const toggleUrl = `/api/packages/toggle?name=${encodeURIComponent(p.name)}`
  return (
    <tr
      class={`row pkg-row${isSelected ? ' row-selected' : ''}`}
      id={`pkg-row-${p.name}`}
      data-on-click={`if(evt.target.closest('input')) return; @get('${detailUrl}')`}
    >
      <td class="col-check">
        <input
          type="checkbox"
          class="pkg-check"
          checked={isChecked}
          data-on-change={`@post('${toggleUrl}')`}
        />
      </td>
      <td class="col-name">
        <span class="pkg-name">{p.name}</span>
        <span class="muted small"> {p.repo}</span>
      </td>
      <td class="col-version mono">{p.version}</td>
    </tr>
  )
}

const PackageHeader = () => (
  <thead>
    <tr>
      <th class="col-check"></th>
      <th>Package</th>
      <th class="col-version">Version</th>
    </tr>
  </thead>
)

const PackageRows = ({ items, state }: { items: PackageEntry[]; state: RowState }) => (
  <table class="table pkg-table">
    <PackageHeader />
    <tbody>
      {items.map((p) => (
        <PackageRow
          p={p}
          isChecked={state.checked.has(p.name)}
          isSelected={state.selectedName === p.name}
        />
      ))}
    </tbody>
  </table>
)

export const PackageRowFragment = ({ p, isChecked, isSelected }: { p: PackageEntry; isChecked: boolean; isSelected: boolean }) => (
  <PackageRow p={p} isChecked={isChecked} isSelected={isSelected} />
)

export const PackageMore = ({ next }: { next: string | null }) => (
  <div id="package-more">
    {next ? (
      <button
        type="button"
        class="btn"
        data-on-click={`@get('/api/packages/list?after=${encodeURIComponent(next)}&mode=append')`}
      >
        Load more
      </button>
    ) : (
      <p class="muted small">End of results.</p>
    )}
  </div>
)

export const PackageList = ({ page, state }: { page: PackageList; state: RowState }) => (
  <>
    <PackageRows items={page.items} state={state} />
    <PackageMore next={page.next} />
  </>
)

export const PackageRowsFragment = ({ items, state }: { items: PackageEntry[]; state: RowState }) => (
  <PackageRows items={items} state={state} />
)

const PackageDetailPanel = ({ detail }: { detail: PackageDetail | null }) => {
  if (!detail) {
    return <p class="muted">Click a package row to see details.</p>
  }
  return (
    <>
      <div class="detail-head">
        <h2 class="card-title">
          {detail.name} <span class="muted small">{detail.version}</span>
        </h2>
      </div>
      <div class="detail-split">
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
        <div class="detail-deps">
          <div class="detail-deps-scroll">
          <table class="table dep-table">
            <thead>
              <tr>
                <th>Dependency</th>
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
    </>
  )
}

export const PackageDetailFragment = ({ detail }: { detail: PackageDetail | null }) => (
  <div id="package-detail" class="card">
    <PackageDetailPanel detail={detail} />
  </div>
)
