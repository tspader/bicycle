import { Page, Section } from './layout'
import type { InstallState } from '../ui-state'

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>]/g

export const collapseTerminal = (s: string): string => {
  const clean = s.replace(ANSI_RE, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  return clean
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r')
      return i >= 0 ? line.slice(i + 1) : line
    })
    .join('\n')
    // archinstall/rich emit cursor-positioning sequences interleaved with
    // literal newlines; once we strip the control bytes, those newlines
    // pile up as huge blank runs. Squash runs of blank lines down to one.
    .replace(/\n[ \t]*(\n[ \t]*){2,}/g, '\n\n')
    .replace(/^\n+/, '')
}

type Props = {
  preflight: { ok: boolean; problems: string[] }
  device: string | null
  mode: 'dry-run' | 'wet'
  install: InstallState
}

export const InstallView = ({ preflight, device, mode, install }: Props) => {
  const sub = mode === 'wet'
    ? 'WET MODE: archinstall will write to disk.'
    : 'Dry-run: archinstall will not touch disks (only the archiso live environment enables real installs).'
  return (
    <Page heading="Install" subhead={sub}>
      <ModeBadge mode={mode} />
      {install.status === 'idle' ? (
        <IdleView preflight={preflight} device={device} mode={mode} />
      ) : (
        <ProgressView install={install} />
      )}
    </Page>
  )
}

const ModeBadge = ({ mode }: { mode: 'dry-run' | 'wet' }) => (
  <div class={`install-mode-badge ${mode === 'wet' ? 'install-mode-wet' : 'install-mode-dry'}`}>
    {mode === 'wet' ? 'WET — disks will be wiped' : 'DRY-RUN'}
  </div>
)

const IdleView = ({
  preflight, device, mode,
}: {
  preflight: { ok: boolean; problems: string[] }
  device: string | null
  mode: 'dry-run' | 'wet'
}) => {
  if (!preflight.ok || !device) {
    return (
      <Section title="Not ready" subhead="Fix these before installing.">
        <ul class="preflight-problems">
          {preflight.problems.map((p) => <li>{p}</li>)}
          {!device && preflight.ok ? <li>No target device.</li> : null}
        </ul>
      </Section>
    )
  }
  const signals = { wipe_typed: '', confirm_install: false }
  return (
    <Section title="Confirm and install" subhead={`Target: ${device}`}>
      <form class="form card" data-signals={JSON.stringify(signals)}>
        <p class="muted small">
          Wiping <span class="mono">{device}</span> will erase all data on the disk.
        </p>
        <label class="field">
          <span class="field-label">Type <span class="mono">{device}</span> to enable Install</span>
          <input
            class="combo mono"
            type="text"
            data-bind="wipe_typed"
            placeholder={device}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck={false}
          />
        </label>
        <div class="form-actions">
          <button
            type="button"
            class="btn"
            data-attr-disabled={`$wipe_typed !== '${device}'`}
            data-on:click="$confirm_install = true"
          >
            Begin install
          </button>
          <span class="muted small" data-show={`$wipe_typed !== '${device}'`}>
            Device path must match exactly.
          </span>
        </div>
        <div class="confirm-modal" data-show="$confirm_install">
          <div class="card confirm-card">
            <p>
              Run archinstall in <strong>{mode === 'wet' ? 'WET' : 'dry-run'}</strong> mode against <span class="mono">{device}</span>?
            </p>
            {mode === 'wet' ? (
              <p class="warn small">This will wipe the disk and install Arch Linux.</p>
            ) : (
              <p class="muted small">No disks will be modified.</p>
            )}
            <div class="form-actions">
              <button type="button" class="btn" data-on:click="$confirm_install = false">
                Cancel
              </button>
              <button
                type="button"
                class={mode === 'wet' ? 'btn btn-danger' : 'btn'}
                data-on:click="@post('/api/install/start')"
              >
                {mode === 'wet' ? 'Wipe and install' : 'Run dry-run'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Section>
  )
}

const ProgressView = ({ install }: { install: InstallState }) => (
  <Section title="Install progress" subhead={`mode: ${install.mode}`}>
    <ProgressCard install={install} />
  </Section>
)

export const ProgressCard = ({ install }: { install: InstallState }) => {
  const running = install.status === 'running'
  const succeeded = install.status === 'success'
  const failed = install.status === 'failure'
  const pollAttr = running
    ? { 'data-on-interval__duration.500ms': "@get('/api/install/tick')" }
    : {}
  const text = collapseTerminal(install.log) || '(no output yet)'
  return (
    <div id="install-progress" class="card install-progress" {...pollAttr}>
      <div class="install-status-row">
        <StatusPill status={install.status} />
        {install.exitCode != null ? <span class="muted small mono">exit {install.exitCode}</span> : null}
      </div>
      <pre class="install-log mono small" id="install-log">{text}</pre>
      {succeeded ? (
        <div class="form-actions">
          <button
            type="button"
            class="btn btn-danger"
            data-on:click="confirm('Reboot now?') && @post('/api/install/reboot')"
          >
            Reboot
          </button>
          <span class="muted small">Remove the install media before rebooting.</span>
        </div>
      ) : null}
      {failed ? (
        <div class="form-actions">
          <button
            type="button"
            class="btn"
            data-on:click="@post('/api/install/reset')"
          >
            Dismiss
          </button>
          <span class="muted small">See /var/log/archinstall/install.log on the host.</span>
        </div>
      ) : null}
    </div>
  )
}

const StatusPill = ({ status }: { status: InstallState['status'] }) => {
  const cls =
    status === 'running' ? 'pill pill-info'
    : status === 'success' ? 'pill pill-ok'
    : status === 'failure' ? 'pill pill-danger'
    : 'pill'
  return <span class={cls}>{status}</span>
}
