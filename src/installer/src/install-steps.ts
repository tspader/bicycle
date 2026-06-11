import { mkdirSync, writeFileSync, chmodSync, chownSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encrypt } from './age'
import { secretRelPath } from './secrets'
import type { TreeFile } from './import-tree'

export type InstallStep =
  // A native filesystem operation run from this process. Preferred for
  // file/dir writes — avoids shell-escaping and heredoc-sentinel hazards.
  | { kind: 'fs'; label: string; run: () => Promise<void> | void }
  // A subprocess invocation. Reserved for things only the shell + binaries can
  // do (e.g. `arch-chroot /mnt pacman -U`).
  | { kind: 'shell'; label: string; argv: string[] }

export type InstallStepInput = {
  // The bicycle.yml text — written verbatim (byte-for-byte for an unedited
  // import, the user's surgical edits otherwise).
  text: string
  // The supporting tree, keyed by path relative to /etc/bicycle (apps/**,
  // files/**, secrets/**.age, recipients). Curated on import — never contains
  // age.key or .git. Each entry carries its source mode so e.g. executable
  // scripts under files/ survive the install (secrets are clamped 0600
  // regardless).
  files: ReadonlyMap<string, TreeFile>
  // age identity written to <etcRoot>/age.key (mode 0600). Never part of files.
  identity: string | null
  // Cleartext secrets entered in the UI, encrypted here to `recipients` and
  // written as secrets/<addr>.age. Imported secrets already live in `files`.
  pendingSecrets?: { addr: string; clear: string }[]
  // age recipients ("age1...") to encrypt `pendingSecrets` to. Must correspond
  // to the identity landing at <etcRoot>/age.key.
  recipients?: string[]
  // Override for tests; defaults to '/mnt' (the live archinstall target).
  mountRoot?: string
}

const chownIfRoot = (path: string): void => {
  try {
    if (typeof process !== 'undefined' && process.getuid?.() === 0) {
      chownSync(path, 0, 0)
    }
  } catch {
    // best-effort
  }
}

const isSecret = (rel: string): boolean => rel === 'age.key' || rel.startsWith('secrets/')

const writeInto = (
  etcRoot: string,
  rel: string,
  bytes: Uint8Array | string,
  srcMode?: number,
): void => {
  const dest = join(etcRoot, rel)
  mkdirSync(dirname(dest), { recursive: true })
  const mode = isSecret(rel) ? 0o600 : srcMode ?? 0o644
  writeFileSync(dest, bytes, { mode })
  chmodSync(dest, mode)
  chownIfRoot(dest)
}

/**
 * Build the post-archinstall sequence: write the whole Bicycle config tree to
 * <mountRoot>/etc/bicycle, write the age identity separately, then install the
 * bicycle package last and reconcile once in the chroot. The package's
 * post_install enables bicycle.service, which expects the config tree to exist
 * — so ordering matters.
 */
export const buildInstallSteps = (input: InstallStepInput): InstallStep[] => {
  const steps: InstallStep[] = []
  const mountRoot = input.mountRoot ?? '/mnt'
  const etcRoot = join(mountRoot, 'etc', 'bicycle')
  const pending = input.pendingSecrets ?? []
  const recipients = input.recipients ?? []

  // 1. Write the entire config tree: bicycle.yml + every supporting file.
  steps.push({
    kind: 'fs',
    label: `write config tree to ${etcRoot}`,
    run: () => {
      mkdirSync(etcRoot, { recursive: true, mode: 0o755 })
      chownIfRoot(etcRoot)
      writeInto(etcRoot, 'bicycle.yml', input.text)
      for (const [rel, f] of input.files) writeInto(etcRoot, rel, f.bytes, f.mode)
    },
  })

  // 2. Write the age identity from in-memory state, mode 0600. Never part of
  //    the files map — it's the master key, held in memory only until here.
  if (input.identity) {
    steps.push({
      kind: 'fs',
      label: `write ${etcRoot}/age.key`,
      run: () => {
        mkdirSync(etcRoot, { recursive: true, mode: 0o755 })
        writeInto(etcRoot, 'age.key', input.identity!)
      },
    })
  }

  // 3. Encrypt UI-entered secrets to the resolved recipients, plus a recipients
  //    file (so the daemon can encrypt future secrets) unless the tree already
  //    carries one.
  if (pending.length > 0) {
    steps.push({
      kind: 'fs',
      label: `write ${pending.length} UI secret(s) under ${etcRoot}/secrets`,
      run: async () => {
        if (recipients.length === 0) {
          throw new Error('cannot encrypt UI secrets: no age recipients resolved')
        }
        for (const { addr, clear } of pending) {
          writeInto(etcRoot, secretRelPath(addr), await encrypt(clear, recipients))
        }
        if (!input.files.has('recipients')) {
          writeInto(etcRoot, 'recipients', recipients.join('\n') + '\n')
        }
      },
    })
  }

  // 4. Install the bicycle package so its binary + service are present, with
  //    the config tree already in place for its post_install hook.
  steps.push({
    kind: 'shell',
    label: 'install bicycle pkg into target',
    argv: ['sh', '-c', [
      'set -e',
      'pkg=$(ls /root/bicycle-pkg/bicycle-*.pkg.tar.zst | head -1)',
      'name=$(basename "$pkg")',
      `cp "$pkg" ${join(mountRoot, 'root')}/`,
      `arch-chroot ${mountRoot} pacman -U --noconfirm "/root/$name"`,
    ].join('\n')],
  })

  // 5. Populate users/groups/dirs/files before first boot by running the
  //    daemon's own reconcilers once in the chroot. archinstall isn't handed
  //    any users (see splitForArchinstall): the daemon creates accounts, sets
  //    passwords from secrets, creates custom groups, fixes membership, writes
  //    the sudoers drop-in, and lays down dirs/files. packages/systemd/app need
  //    a running init + network, so they wait for first boot.
  steps.push({
    kind: 'shell',
    label: 'reconcile users/groups/dirs/files into target (chroot)',
    argv: ['arch-chroot', mountRoot, 'bicycle', 'reconcile-once',
      '--only', 'groups', 'users', 'sudoers', 'dirs', 'files'],
  })

  return steps
}
