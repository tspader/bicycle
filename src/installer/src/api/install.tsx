import { HTTPException } from 'hono/http-exception'
import { existsSync } from 'node:fs'
import { InstallView, ProgressCard, installSignals } from '../views/install'
import { listDisks } from '../system'
import { preflight, targetDevice } from '../config'
import { getInstall, setInstall, appendInstallLog } from '../ui-state'
import {
  getText, getFiles, getIdentity, getRootHash, getEncryptionPassword, getPendingSecrets,
  setIdentity,
} from '../state'
import { recipientFor, generate as generateAgeIdentity } from '../age'
import { buildInstallSteps } from '../install-steps'
import { spawn as runtimeSpawn } from '../runtime'
import type { AppContext } from '../http'
import { routes } from '../routes'
import { configState, type ConfigState, preflightCtx, renderPage, patch } from '../render'

const isWet = (): boolean => existsSync('/run/archiso/bootmnt')

export const configJson = (c: AppContext) => {
  const { archinstall, error } = configState()
  if (!archinstall) throw new HTTPException(400, { message: error ?? 'invalid config' })
  return c.json(archinstall)
}

const archinstallFiles = (cfg: NonNullable<ConfigState['archinstall']>) => {
  const creds: Record<string, unknown> = {}
  const root = getRootHash()
  const enc = getEncryptionPassword()
  if (root) creds.root_enc_password = root
  if (enc) creds.encryption_password = enc
  return { config: cfg, creds }
}

const renderInstall = async (c: AppContext) => {
  const { bike, archinstall, error } = configState()
  const disks = await listDisks()
  const pf = archinstall
    ? preflight(archinstall, disks, preflightCtx(bike))
    : { ok: false as const, problems: [error ?? 'invalid config'] }
  const view = (
    <InstallView
      preflight={pf}
      device={archinstall ? targetDevice(archinstall) : null}
      mode={isWet() ? 'wet' : 'dry-run'}
      install={getInstall()}
    />
  )
  return renderPage(c, 'install', view, '/install')
}

export const page = (c: AppContext) => renderInstall(c)

// The poller passes the status it rendered with; when the install transitions,
// fall back to a full page render so the idle/progress sections swap too.
export const tick = (c: AppContext) => {
  const inst = getInstall()
  const { s } = routes.installTick.params(c)
  if (s && s !== inst.status) {
    return renderInstall(c)
  }
  return patch(<ProgressCard install={inst} />)
}

export const status = (c: AppContext) => renderInstall(c)

export const start = async (c: AppContext) => {
  const inst = getInstall()
  if (inst.status === 'running') {
    throw new HTTPException(409, { message: 'install already running' })
  }
  const { bike, archinstall, error } = configState()
  if (!archinstall) throw new HTTPException(400, { message: error ?? 'invalid config' })
  const device = targetDevice(archinstall)
  if (!device) throw new HTTPException(400, { message: 'no target device' })

  const confirm = installSignals.read(c)
  if (confirm.wipe_typed !== device) {
    throw new HTTPException(400, { message: `type ${device} to confirm wipe (got ${JSON.stringify(confirm.wipe_typed)})` })
  }
  if (!confirm.confirm_install) {
    throw new HTTPException(400, { message: 'install confirmation required' })
  }

  const wet = isWet()
  const mode = wet ? 'wet' as const : 'dry-run' as const
  setInstall({
    status: 'running', mode, device, log: '',
    exitCode: null, startedAt: Date.now(), finishedAt: null,
  })

  try {
    const disks = await listDisks()
    const pf = preflight(archinstall, disks, preflightCtx(bike))
    if (!pf.ok) {
      setInstall({ status: 'idle', startedAt: null })
      throw new HTTPException(400, { message: pf.problems.join('; ') })
    }
    const { config, creds } = archinstallFiles(archinstall)
    const configFile = '/tmp/bicycle-config.json'
    const credsFile = '/tmp/bicycle-creds.json'
    await Bun.write(configFile, JSON.stringify(config, null, 2))
    await Bun.write(credsFile, JSON.stringify(creds, null, 2))

    const args = ['archinstall', '--config', configFile, '--creds', credsFile, '--silent', '--script', 'guided']
    if (!wet) args.push('--dry-run')

    void runInstall(args, wet)
  } catch (e) {
    if (e instanceof HTTPException) throw e
    setInstall({ status: 'failure', exitCode: -1, finishedAt: Date.now() })
    appendInstallLog(`start failed: ${(e as Error).message}\n`)
  }

  return renderInstall(c)
}

const pump = async (stream: ReadableStream<Uint8Array> | null) => {
  if (!stream) return
  const reader = stream.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    appendInstallLog(dec.decode(value, { stream: true }))
  }
}

const runStep = async (label: string, args: string[]): Promise<number> => {
  appendInstallLog(`\n$ ${label}\n`)
  let proc
  try {
    proc = runtimeSpawn(args, { stdout: 'pipe', stderr: 'pipe' })
  } catch (e) {
    appendInstallLog(`spawn failed: ${(e as Error).message}\n`)
    return -1
  }
  try {
    await Promise.all([pump(proc.stdout), pump(proc.stderr)])
    return await proc.exited
  } catch (e) {
    appendInstallLog(`pump failed: ${(e as Error).message}\n`)
    return -1
  }
}

const parseRecipients = (text: string): string[] =>
  text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

const postArchinstall = async (): Promise<number> => {
  const files = new Map(getFiles())
  const pending = [...getPendingSecrets()].map(([addr, clear]) => ({ addr, clear }))

  let identity = getIdentity()
  let recipients: string[] = []
  if (pending.length > 0) {
    const imported = files.get('recipients')
    if (imported) recipients = parseRecipients(new TextDecoder().decode(imported.bytes))
    if (recipients.length === 0) {
      files.delete('recipients')
      if (!identity) {
        identity = await generateAgeIdentity()
        setIdentity(identity)
        appendInstallLog('\n(note) generated a new age identity to encrypt UI secrets\n')
      }
      recipients = [await recipientFor(identity)]
    }
  }

  if (!identity) {
    appendInstallLog('\n(note) no age identity set; skipping /mnt/etc/bicycle/age.key write\n')
  }

  const steps = buildInstallSteps({
    text: getText(),
    files,
    identity,
    pendingSecrets: pending,
    recipients,
  })
  for (const step of steps) {
    if (step.kind === 'shell') {
      const code = await runStep(step.label, step.argv)
      if (code !== 0) return code
    } else {
      appendInstallLog(`\n$ ${step.label}\n`)
      try {
        await step.run()
      } catch (e) {
        appendInstallLog(`${step.label} failed: ${(e as Error).message}\n`)
        return -1
      }
    }
  }
  return 0
}

const runInstall = async (args: string[], wet: boolean): Promise<void> => {
  const code = await runStep(args.join(' '), args)
  if (code !== 0) {
    setInstall({ status: 'failure', exitCode: code, finishedAt: Date.now() })
    return
  }
  if (wet) {
    const postCode = await postArchinstall()
    if (postCode !== 0) {
      setInstall({ status: 'failure', exitCode: postCode, finishedAt: Date.now() })
      return
    }
  }
  setInstall({ status: 'success', exitCode: 0, finishedAt: Date.now() })
}

export const reboot = (c: AppContext) => {
  if (!isWet()) throw new HTTPException(400, { message: 'reboot disabled in dry-run mode' })
  if (getInstall().status !== 'success') {
    throw new HTTPException(400, { message: 'reboot only after a successful install' })
  }
  runtimeSpawn(['systemctl', 'reboot'], { stdout: 'ignore', stderr: 'ignore' })
  return c.body('')
}

export const reset = (c: AppContext) => {
  if (getInstall().status === 'running') {
    throw new HTTPException(409, { message: 'cannot reset while running' })
  }
  setInstall({
    status: 'idle', log: '', exitCode: null, startedAt: null, finishedAt: null,
  })
  return renderInstall(c)
}
