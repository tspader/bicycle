import { test, expect, beforeEach } from 'bun:test'
import {
  getSource, setSource, clearSource, setState, replaceState, getState,
} from '../src/state'

beforeEach(() => {
  clearSource()
  // Reset to a neutral state for each test.
  replaceState({
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
    mirror_config: { mirror_regions: {}, custom_servers: [], custom_repositories: [], optional_repositories: [] },
    root_enc_password: null,
  })
})

test('setSource then getSource round-trips', () => {
  setSource({ yaml: 'core:\n  hostname: x\n', tree: null, ownsTree: false, dirty: false })
  expect(getSource()?.yaml).toContain('hostname: x')
  expect(getSource()?.tree).toBe(null)
})

test('replaceState preserves source (used by importers)', () => {
  setSource({ yaml: 'orig', tree: null, ownsTree: false, dirty: false })
  replaceState({ ...getState(), hostname: 'replaced' })
  expect(getSource()?.yaml).toBe('orig')
  expect(getState().hostname).toBe('replaced')
})

test('setState (UI mutation) marks source dirty but keeps tree', () => {
  setSource({ yaml: 'orig', tree: '/tmp/bicycle-import-fake', ownsTree: true, dirty: false })
  setState({ hostname: 'edited' })
  // Tree must survive so install can still publish supporting files (apps/,
  // files/, secrets/, recipients/) that aren't reachable from the UI.
  expect(getSource()?.tree).toBe('/tmp/bicycle-import-fake')
  expect(getSource()?.dirty).toBe(true)
  // Cleanup: we lied about the tree, prevent setSource from rm -rfing it.
  setSource({ ...getSource()!, ownsTree: false })
  setSource(null)
})

test('clearSource is idempotent', () => {
  clearSource()
  clearSource()
  expect(getSource()).toBeNull()
})
