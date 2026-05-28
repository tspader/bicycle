import { rmSync } from 'node:fs'
import type { ArchinstallConfig, RetainedDoc } from './config'

let state: ArchinstallConfig = {
  hostname: 'bicycle-test',
  kernels: ['linux'],
  ntp: true,
  locale_config: { kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' },
  bootloader_config: { bootloader: 'Systemd-boot', uki: true, removable: false },
  swap: { enabled: true, algorithm: 'zstd' },
  network_config: { type: 'iso' },
  timezone: 'UTC',
  packages: [],
  users: [],
  mirror_config: {
    mirror_regions: {},
    custom_servers: [],
    custom_repositories: [],
    optional_repositories: [],
  },
  root_enc_password: null,
}

export const getState = (): Readonly<ArchinstallConfig> => state

// UI mutations diverge the derived state from `source.yaml`, so the source
// preview becomes stale. We do NOT drop `source.tree` here, because the
// imported tree still carries the supporting subdirs (apps/, files/,
// secrets/, recipients) that install must copy to /mnt/etc/bicycle — and
// dropping them just because the user typed a root password or fixed a
// typo would silently lose all of that. Install regenerates bicycle.yml
// from the derived state instead.
export const setState = (patch: Partial<ArchinstallConfig>): void => {
  state = { ...state, ...patch }
  if (source) source = { ...source, dirty: true }
}

// Used by importers to install a brand-new derived state. Does NOT touch
// `source`; the caller is responsible for setSource() right after.
export const replaceState = (next: ArchinstallConfig): void => {
  state = next
}

let retained: RetainedDoc = {}

export const getRetained = (): Readonly<RetainedDoc> => retained

export const setRetained = (next: RetainedDoc): void => {
  retained = next
}

export type SourceDoc = {
  // Raw bicycle.yml text as imported — the preview shows it verbatim until
  // a UI mutation marks the source `dirty`.
  yaml: string
  // Path to the config root on disk that holds apps/, files/, secrets/,
  // recipients alongside bicycle.yml. Set when imported from Git so install
  // can copy the entire tree into /mnt/etc/bicycle. null when the source is
  // a single YAML document (paste/upload imports).
  tree: string | null
  // True when the installer owns this tree dir and should clean it up on
  // replace/clear (e.g. /tmp/bicycle-import-XXX). False when `tree` points
  // at something the user owns and we must never delete (e.g. an example
  // fixture path, a manually-staged dir for testing).
  ownsTree: boolean
  // True once the user has performed any UI mutation since import. While
  // false, the preview shows source.yaml verbatim and install copies the
  // entire tree verbatim. Once true, install regenerates bicycle.yml from
  // the derived state but still copies supporting files from `tree`.
  dirty: boolean
}

let source: SourceDoc | null = null

export const getSource = (): Readonly<SourceDoc> | null => source

export const setSource = (next: SourceDoc | null): void => {
  const prev = source
  source = next
  // Best-effort cleanup of the previous tree dir when we owned it and it's
  // being replaced or cleared — otherwise repeated imports leak /tmp dirs.
  if (prev?.tree && prev.ownsTree && prev.tree !== next?.tree) {
    try { rmSync(prev.tree, { recursive: true, force: true }) } catch {}
  }
}

export const clearSource = (): void => setSource(null)
