import { z } from 'zod'
import { Field, Page, Section } from './layout'
import { attr, bind, effect, expr, not, on, signals, text, when } from '@bicycle/datastar'
import { routes } from '../routes'

export const gitImportSignals = signals(
  {
    git_url: z.string().trim().min(1, 'repository URL required'),
    git_user: z.string().default(''),
    git_pass: z.string().default(''),
  },
  'import_',
)

export const importStatusSignals = signals(
  {
    status: z.string().default(''),
    error: z.string().default(''),
  },
  'import_',
)

export const ageSignals = signals(
  {
    identity: z.string().default(''),
    key_file: z
      .array(z.object({ name: z.string(), contents: z.string(), mime: z.string() }))
      .default([]),
  },
  'age_',
)

export const ImportView = ({ ageKeySet }: { ageKeySet: boolean }) => (
  <Page
    heading="Import"
    subhead="Load an existing configuration to replace the current one."
  >
    <Section
      title="From Git repository"
      subhead="Clones over HTTPS and reads .bicycle/bicycle.yml from the repository root."
    >
      <form
        class="form card"
        {...gitImportSignals.seed({ git_url: '', git_user: '', git_pass: '' })}
        {...on('submit', routes.importGit.action())}
      >
        <Field label="Repository URL" htmlFor="import-git-url">
          <input
            id="import-git-url"
            class="combo mono"
            type="text"
            placeholder="https://github.com/you/your-config.git"
            {...bind(gitImportSignals.$.git_url)}
          />
        </Field>
        <Field label="Username (optional)" htmlFor="import-git-user">
          <input
            id="import-git-user"
            class="combo"
            type="text"
            autocomplete="off"
            {...bind(gitImportSignals.$.git_user)}
          />
        </Field>
        <Field label="Password / token (optional)" htmlFor="import-git-pass">
          <input
            id="import-git-pass"
            class="combo"
            type="password"
            autocomplete="off"
            {...bind(gitImportSignals.$.git_pass)}
          />
        </Field>
        <p class="muted small">
          SSH is not supported on the install medium (no keys). For private
          repos, GitHub requires a personal access token in place of the password.
        </p>
        <div class="field-control">
          <button class="btn" type="submit" {...attr('disabled', not(gitImportSignals.$.git_url))}>
            Clone and import
          </button>
        </div>
      </form>
    </Section>

    <AgeSection ageKeySet={ageKeySet} />

    <div {...importStatusSignals.seed({ status: '', error: '' })}>
      <p id="import-status" class="muted small import-msg" {...text(importStatusSignals.$.status)} />
      <div id="import-error" class="alert alert-danger import-msg" {...text(importStatusSignals.$.error)} />
    </div>
  </Page>
)

export const AgeSection = ({ ageKeySet }: { ageKeySet: boolean }) => (
  <section id="age-section">
    <Section
      title="Age identity for secrets"
      subhead="Private key used at runtime to decrypt age-encrypted secrets and files."
    >
      <div class="form card" {...ageSignals.seed({ identity: '', key_file: [] })}>
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
              <button class="btn" type="button" {...on('click', routes.ageKeyClear.action())}>
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
            {...bind(ageSignals.$.identity)}
          />
        </Field>
        <div class="field-control">
          <button
            class="btn"
            type="button"
            {...on('click', routes.ageKeySet.action())}
            {...attr('disabled', not(ageSignals.$.identity))}
          >
            Save identity
          </button>
        </div>
        <Field label="Or import from key file" htmlFor="age-key-file">
          <input
            id="age-key-file"
            class="combo"
            type="file"
            accept=".key,.txt,text/plain"
            {...bind(ageSignals.$.key_file)}
            {...effect(when(expr`${ageSignals.$.key_file}.length > 0`, routes.ageKeyFile.action()))}
          />
        </Field>
      </div>
    </Section>
  </section>
)
