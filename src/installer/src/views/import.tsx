import { Field, Page, Section } from './layout'

const FILE_PICKER_JS = `
  (async () => {
    const f = event.target.files && event.target.files[0]
    if (!f) return
    event.target.value = ''
    const status = document.getElementById('import-status')
    const error = document.getElementById('import-error')
    if (status) status.textContent = 'Reading file…'
    if (error) error.textContent = ''
    try {
      const toml = await f.text()
      const r = await fetch('/api/import/toml', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'datastar-request': 'true',
        },
        body: JSON.stringify({ toml }),
      })
      if (!r.ok) {
        const msg = await r.text()
        throw new Error(msg || ('HTTP ' + r.status))
      }
      location.reload()
    } catch (e) {
      if (status) status.textContent = ''
      if (error) error.textContent = 'Import failed: ' + (e && e.message ? e.message : e)
    }
  })()
`

export const ImportView = () => {
  const signals = {
    import_git_url: '',
    import_git_user: '',
    import_git_pass: '',
    import_status: '',
    import_error: '',
  }
  return (
    <Page
      heading="Import"
      subhead="Load an existing configuration to replace the current one."
    >
      <div data-signals={JSON.stringify(signals)}>
        <Section
          title="From Git repository"
          subhead="Clones over HTTPS and reads .bicycle/machine.toml from the repository root."
        >
          <form class="form card" data-on:submit__prevent="@post('/api/import/git')">
            <Field label="Repository URL" htmlFor="import-git-url">
              <input
                id="import-git-url"
                class="combo mono"
                type="text"
                placeholder="https://github.com/you/your-config.git"
                data-bind="import_git_url"
              />
            </Field>
            <Field label="Username (optional)" htmlFor="import-git-user">
              <input
                id="import-git-user"
                class="combo"
                type="text"
                autocomplete="off"
                data-bind="import_git_user"
              />
            </Field>
            <Field label="Password / token (optional)" htmlFor="import-git-pass">
              <input
                id="import-git-pass"
                class="combo"
                type="password"
                autocomplete="off"
                data-bind="import_git_pass"
              />
            </Field>
            <p class="muted small">
              SSH is not supported on the install medium (no keys). For private
              repos, GitHub requires a personal access token in place of the password.
            </p>
            <div class="field-control">
              <button class="btn" type="submit" data-attr:disabled="!$import_git_url">
                Clone and import
              </button>
            </div>
          </form>
        </Section>

        <Section
          title="From local TOML file"
          subhead="Pick a .bicycle/machine.toml from this machine (the one running the browser)."
        >
          <div class="form card">
            <Field label="machine.toml" htmlFor="import-toml-file">
              <input
                id="import-toml-file"
                class="combo"
                type="file"
                accept=".toml,text/plain"
                onchange={FILE_PICKER_JS}
              />
            </Field>
            <p class="muted small">
              After a successful import the page reloads to reflect the new state.
            </p>
          </div>
        </Section>

        <p
          id="import-status"
          class="muted small import-msg"
          data-text="$import_status"
        >
          {''}
        </p>
        <div
          id="import-error"
          class="alert alert-danger import-msg"
          data-text="$import_error"
        >
          {''}
        </div>
      </div>
    </Page>
  )
}
