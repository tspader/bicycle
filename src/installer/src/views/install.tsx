import { z } from 'zod'
import { Page, Section } from './layout'
import type { InstallState } from '../ui-state'
import { attr, bind, expr, ne, on, onInterval, show, signals, when } from '@bicycle/datastar'
import { routes } from '../routes'

export const installSignals = signals({
  wipe_typed: z.string().default(''),
})

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

export const InstallView = ({ preflight, device, mode, install }: Props) => (
  <Page heading="Install" subhead="Run archinstall against the assembled config.">
    <ModeBadge mode={mode} />
    {install.status === 'idle' ? (
      <IdleView preflight={preflight} device={device} mode={mode} />
    ) : (
      <ProgressView install={install} />
    )}
  </Page>
)

const ModeBadge = ({ mode }: { mode: 'dry-run' | 'wet' }) => (
  <div class={`install-mode-badge ${mode === 'wet' ? 'install-mode-wet' : 'install-mode-dry'}`}>
    {mode === 'wet'
      ? 'WET — archinstall will write to disk'
      : 'DRY-RUN — disks will not be touched (real installs only run from the archiso live environment)'}
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
  if (mode === 'dry-run') {
    return (
      <Section title="Dry run" subhead={`Target: ${device}`}>
        <form class="form card" {...installSignals.seed({ wipe_typed: '' })}>
          <p class="muted small">
            Runs archinstall with <span class="mono">--dry-run</span> against{' '}
            <span class="mono">{device}</span>. No disks are modified.
          </p>
          <div class="form-actions">
            <button type="button" class="btn" {...on('click', routes.installStart.action())}>
              Run dry-run
            </button>
          </div>
        </form>
      </Section>
    )
  }
  const $ = installSignals.$
  const mismatch = ne($.wipe_typed, device)
  return (
    <Section title="Confirm and install" subhead={`Target: ${device}`}>
      <form class="form card" {...installSignals.seed({ wipe_typed: '' })}>
        <p class="muted small">
          Installing wipes <span class="mono">{device}</span> and erases all data on it.
        </p>
        <label class="field">
          <span class="field-label">Type <span class="mono">{device}</span> to confirm</span>
          <input
            class="combo mono"
            type="text"
            placeholder={device}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck={false}
            {...bind($.wipe_typed)}
          />
        </label>
        <div class="form-actions">
          <button
            type="button"
            class="btn btn-danger"
            {...attr('disabled', mismatch)}
            {...on('click', routes.installStart.action())}
          >
            Wipe and install
          </button>
          <span class="muted small" {...show(mismatch)}>
            Device path must match exactly.
          </span>
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
  const poll = running ? onInterval(routes.installTick.action({ s: install.status }), 500) : {}
  const text = collapseTerminal(install.log) || '(no output yet)'
  return (
    <div id="install-progress" class="card install-progress" {...poll}>
      <div class="install-status-row">
        <StatusPill status={install.status} />
        {install.exitCode != null ? <span class="muted small mono">exit {install.exitCode}</span> : null}
      </div>
      <log-scroll>
        <pre class="install-log mono small" id="install-log">{text}</pre>
      </log-scroll>
      {succeeded ? (
        <div class="form-actions">
          <button
            type="button"
            class="btn btn-danger"
            {...on('click', when(expr`confirm('Reboot now?')`, routes.installReboot.action()))}
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
            {...on('click', routes.installReset.action())}
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
