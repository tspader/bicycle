import { cpSync, mkdirSync, writeFileSync, chmodSync, chownSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ArchinstallConfig, RetainedDoc } from './config'
import { toYaml } from './config'
import type { SourceDoc } from './state'
import { encrypt } from './age'

export type InstallStep =
  // A native filesystem operation run from this process. Preferred for
  // file/dir writes — avoids shell-escaping and heredoc-sentinel hazards
  // entirely.
  | { kind: 'fs'; label: string; run: () => Promise<void> | void }
  // A subprocess invocation. Reserved for things only the shell + binaries
  // can do (e.g. `arch-chroot /mnt pacman -U`).
  | { kind: 'shell'; label: string; argv: string[] }

export type InstallStepInput = {
  source: SourceDoc | null
  state: ArchinstallConfig
  retained: RetainedDoc
  ageKey: string | null
  packageRepos: Record<string, string>
  // Cleartext UI passwords to persist as age secrets, keyed by username. Each
  // is encrypted to `recipients` and written to
  // <etcRoot>/secrets/users/<name>/password.age. Empty for pure-import builds
  // (those users already carry secret files inside the copied tree).
  userSecrets?: { name: string; clear: string }[]
  // age recipients ("age1...") to encrypt `userSecrets` to. Must correspond to
  // the identity that lands at <etcRoot>/age.key so the daemon can decrypt.
  recipients?: string[]
  // Override for tests; defaults to '/mnt' (the live archinstall target).
  mountRoot?: string
}

const chownIfRoot = (path: string): void => {
  try {
    // Only meaningful on the archiso live env where we run as root. In dev
    // we just skip — the user's UID owns the tmp we'd be trying to chown.
    if (typeof process !== 'undefined' && process.getuid?.() === 0) {
      chownSync(path, 0, 0)
    }
  } catch {
    // best-effort
  }
}

// Walk a source tree and copy every file/dir to `dest`, skipping entries
// whose top-level name matches `skipNames`. We can't use cpSync's `filter`
// across the whole subtree because the user may have legitimate nested
// `.git` or `age.key` files inside `files/`/`secrets/`; only the top level
// is dangerous.
const copyTreeExcludingTop = (src: string, dest: string, skipNames: Set<string>): void => {
  for (const name of readdirSync(src)) {
    if (skipNames.has(name)) continue
    const from = join(src, name)
    const to = join(dest, name)
    cpSync(from, to, { recursive: true })
  }
}

/**
 * Build the post-archinstall sequence: publish the Bicycle config tree to
 * <mountRoot>/etc/bicycle, write the age identity separately, then install
 * the bicycle package last. The package's post_install runs
 * `systemctl enable --now bicycle.service`, which expects the config tree
 * to already exist — so ordering matters.
 */
export const buildInstallSteps = (input: InstallStepInput): InstallStep[] => {
  const steps: InstallStep[] = []
  const mountRoot = input.mountRoot ?? '/mnt'
  const etcRoot = join(mountRoot, 'etc', 'bicycle')

  // 1. Publish supporting files from the source tree (apps/, files/,
  //    secrets/, recipients, …) if we have one. Top-level age.key and .git
  //    are skipped so neither lands on the installed system's worktree.
  if (input.source?.tree) {
    const tree = input.source.tree
    steps.push({
      kind: 'fs',
      label: `publish config tree from ${tree} -> ${etcRoot}`,
      run: () => {
        mkdirSync(etcRoot, { recursive: true, mode: 0o755 })
        // Skip top-level bicycle.yml too — step 2 writes the canonical
        // bicycle.yml from current state (which equals source.yaml when
        // !dirty, and the user's edits otherwise). Copying it here just
        // to overwrite it would be wasted I/O.
        copyTreeExcludingTop(tree, etcRoot, treeCopySkipNames())
        chownIfRoot(etcRoot)
      },
    })
  }

  // 2. Write bicycle.yml. If source is present and clean, this is the
  //    verbatim source text (preserving comments/ordering); otherwise the
  //    derived YAML from current state.
  steps.push({
    kind: 'fs',
    label: `write ${etcRoot}/bicycle.yml`,
    run: () => {
      const docYaml = input.source && !input.source.dirty
        ? input.source.yaml
        : toYaml(input.state, input.retained, input.packageRepos)
      mkdirSync(etcRoot, { recursive: true, mode: 0o755 })
      const yamlPath = join(etcRoot, 'bicycle.yml')
      writeFileSync(yamlPath, docYaml, { mode: 0o644 })
      chownIfRoot(yamlPath)
    },
  })

  // 3. Write the age identity from in-memory state. Never near the source
  //    tree — only to <etcRoot>/age.key with mode 0600.
  if (input.ageKey) {
    steps.push({
      kind: 'fs',
      label: `write ${etcRoot}/age.key`,
      run: () => {
        mkdirSync(etcRoot, { recursive: true, mode: 0o755 })
        const keyPath = join(etcRoot, 'age.key')
        writeFileSync(keyPath, input.ageKey!, { mode: 0o600 })
        chmodSync(keyPath, 0o600)
        chownIfRoot(keyPath)
      },
    })
  }

  // 4. Persist UI-entered user passwords as age secrets, plus the recipients
  //    file the daemon needs to encrypt future secrets. Imported users already
  //    have their password.age inside the copied tree (step 1), so this only
  //    covers users typed/edited in the web UI.
  const userSecrets = input.userSecrets ?? []
  if (userSecrets.length > 0) {
    const recipients = input.recipients ?? []
    steps.push({
      kind: 'fs',
      label: `write ${userSecrets.length} user password secret(s) under ${etcRoot}/secrets`,
      run: async () => {
        if (recipients.length === 0) {
          throw new Error('cannot encrypt user passwords: no age recipients resolved')
        }
        for (const { name, clear } of userSecrets) {
          const dir = join(etcRoot, 'secrets', 'users', name)
          mkdirSync(dir, { recursive: true })
          const dest = join(dir, 'password.age')
          writeFileSync(dest, await encrypt(clear, recipients), { mode: 0o600 })
          chmodSync(dest, 0o600)
          chownIfRoot(dest)
        }
        // Publish the recipients file unless the imported tree already carries
        // one (copied verbatim in step 1, and matching the adopted age.key —
        // overwriting it could orphan the tree's existing secrets).
        const treeHasRecipients =
          !!input.source?.tree && existsSync(join(input.source.tree, 'recipients'))
        if (!treeHasRecipients) {
          const recipientsPath = join(etcRoot, 'recipients')
          writeFileSync(recipientsPath, recipients.join('\n') + '\n', { mode: 0o644 })
          chownIfRoot(recipientsPath)
        }
      },
    })
  }

  // 5. Install the bicycle package so its binary + service are present on the
  //    target, with the config tree already in place for its post_install hook.
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

  // 6. Populate users/groups/dirs/files on the target BEFORE first boot by
  //    running the daemon's own reconcilers once, inside the chroot. This is
  //    why archinstall isn't handed any users (splitForArchinstall): the daemon
  //    creates accounts, sets passwords from secrets, creates custom groups,
  //    fixes membership, writes the sudoers drop-in, and lays down dirs/files.
  //    The remaining reconcilers
  //    (packages/systemd/app) need a running init + network, so they wait for
  //    the daemon's startup sweep on first boot.
  steps.push({
    kind: 'shell',
    label: 'reconcile users/groups/dirs/files into target (chroot)',
    argv: ['arch-chroot', mountRoot, 'bicycle', 'reconcile-once',
      '--only', 'groups', 'users', 'sudoers', 'dirs', 'files'],
  })

  return steps
}

// Helpers re-exported for callers that want to assert on what files would
// land on the target without actually running the steps.
export const treeCopySkipNames = (): Set<string> => new Set(['age.key', '.git', 'bicycle.yml'])
