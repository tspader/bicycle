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
      const yaml = await f.text()
      const r = await fetch('/api/import/yaml', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'datastar-request': 'true',
        },
        body: JSON.stringify({ yaml }),
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

const AGE_FILE_PICKER_JS = `
  (async () => {
    const f = event.target.files && event.target.files[0]
    if (!f) return
    event.target.value = ''
    const status = document.getElementById('import-status')
    const error = document.getElementById('import-error')
    if (status) status.textContent = 'Reading key file…'
    if (error) error.textContent = ''
    try {
      const text = await f.text()
      const lines = text.split(/\\r?\\n/).map((l) => l.trim())
      const identity = lines.find((l) => l.startsWith('AGE-SECRET-KEY-')) || ''
      if (!identity) throw new Error('no AGE-SECRET-KEY- line found in file')
      const r = await fetch('/api/secrets/age-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'datastar-request': 'true',
        },
        body: JSON.stringify({ identity }),
      })
      if (!r.ok) {
        const msg = await r.text()
        throw new Error(msg || ('HTTP ' + r.status))
      }
      location.reload()
    } catch (e) {
      if (status) status.textContent = ''
      if (error) error.textContent = 'Age key import failed: ' + (e && e.message ? e.message : e)
    }
  })()
`

const AGE_SAVE_JS = `
  (async () => {
    const status = document.getElementById('import-status')
    const error = document.getElementById('import-error')
    if (status) status.textContent = 'Saving age identity…'
    if (error) error.textContent = ''
    try {
      const identity = ($age_identity || '').trim()
      if (!identity) throw new Error('paste an AGE-SECRET-KEY- identity')
      const r = await fetch('/api/secrets/age-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'datastar-request': 'true',
        },
        body: JSON.stringify({ identity }),
      })
      if (!r.ok) {
        const msg = await r.text()
        throw new Error(msg || ('HTTP ' + r.status))
      }
      location.reload()
    } catch (e) {
      if (status) status.textContent = ''
      if (error) error.textContent = 'Save failed: ' + (e && e.message ? e.message : e)
    }
  })()
`

const AGE_CLEAR_JS = `
  (async () => {
    const error = document.getElementById('import-error')
    if (error) error.textContent = ''
    try {
      const r = await fetch('/api/secrets/age-key/clear', {
        method: 'POST',
        headers: { 'datastar-request': 'true' },
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      location.reload()
    } catch (e) {
      if (error) error.textContent = 'Clear failed: ' + (e && e.message ? e.message : e)
    }
  })()
`

export const ImportView = ({ ageKeySet }: { ageKeySet: boolean }) => {
  const signals = {
    import_git_url: '',
    import_git_user: '',
    import_git_pass: '',
    import_status: '',
    import_error: '',
    age_identity: '',
  }
  return (
    <Page
      heading="Import"
      subhead="Load an existing configuration to replace the current one."
    >
      <div data-signals={JSON.stringify(signals)}>
        <Section
          title="From Git repository"
          subhead="Clones over HTTPS and reads .bicycle/bicycle.yml from the repository root."
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
          title="From local YAML file"
          subhead="Pick a bicycle.yml from this machine (the one running the browser)."
        >
          <div class="form card">
            <Field label="bicycle.yml" htmlFor="import-yaml-file">
              <input
                id="import-yaml-file"
                class="combo"
                type="file"
                accept=".yml,.yaml,text/yaml,text/plain"
                onchange={FILE_PICKER_JS}
              />
            </Field>
            <p class="muted small">
              After a successful import the page reloads to reflect the new state.
            </p>
          </div>
        </Section>

        <Section
          title="Age identity for secrets"
          subhead="Private key used at runtime to decrypt age-encrypted secrets and files."
        >
          <div class="form card">
            <p class="muted small">
              The identity is written once to <span class="mono">/etc/bicycle/age.key</span> on
              the target (mode 0600, root:root) during post-install. It is held only in this
              installer's memory and never persisted to the install medium beyond that.
            </p>
            {ageKeySet ? (
              <div class="field">
                <div class="field-control">
                  <span class="muted">✓ identity set</span>
                  {' '}
                  <button class="btn" type="button" data-on:click={AGE_CLEAR_JS}>
                    Clear
                  </button>
                </div>
              </div>
            ) : null}
            <Field label="Paste AGE-SECRET-KEY-..." htmlFor="age-identity-input">
              <input
                id="age-identity-input"
                class="combo mono"
                type="password"
                autocomplete="off"
                placeholder="AGE-SECRET-KEY-1..."
                data-bind="age_identity"
              />
            </Field>
            <div class="field-control">
              <button class="btn" type="button" data-on:click={AGE_SAVE_JS} data-attr:disabled="!$age_identity">
                Save identity
              </button>
            </div>
            <Field label="Or import from key file" htmlFor="age-key-file">
              <input
                id="age-key-file"
                class="combo"
                type="file"
                accept=".key,.txt,text/plain"
                onchange={AGE_FILE_PICKER_JS}
              />
            </Field>
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
