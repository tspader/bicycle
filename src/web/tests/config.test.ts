import { describe, test, expect } from 'bun:test'
import { fromToml, toToml, parseSize, formatSize, ArchinstallConfig } from '../src/config'

const MINIMAL = `
[core]
hostname = "mark"
timezone = "America/New_York"
kernels = ["linux"]
ntp = true

[locale]
keyboard = "us"
language = "en_US.UTF-8"
encoding = "UTF-8"

[boot]
loader = "systemd-boot"
uki = true
removable = false

[[disk]]
device = "/dev/vda"
wipe = true
table = "gpt"

  [[disk.partition]]
  mount = "/boot"
  fs    = "fat32"
  size  = "1GiB"
  start = "1MiB"
  flags = ["boot", "esp"]

  [[disk.partition]]
  mount = "/"
  fs    = "ext4"
  size  = "rest"

[swap]
enabled = true
algorithm = "zstd"

[[user]]
name = "spader"
sudo = true
groups = ["wheel"]

[packages]
extra = ["git", "vim"]

[pacman.mirrors]
regions = ["United States"]

[network]
mode = "iso"
`

describe('size parsing', () => {
  test('parses MiB/GiB/B', () => {
    expect(parseSize('512MiB')).toMatchObject({ unit: 'MiB', value: 512 })
    expect(parseSize('1GiB')).toMatchObject({ unit: 'GiB', value: 1 })
    expect(parseSize('1024B')).toMatchObject({ unit: 'B', value: 1024 })
  })
  test('rest maps to Percent 100', () => {
    expect(parseSize('rest')).toMatchObject({ unit: 'Percent', value: 100 })
  })
  test('formatSize round-trips', () => {
    expect(formatSize(parseSize('1GiB'))).toBe('1GiB')
    expect(formatSize(parseSize('rest'))).toBe('rest')
  })
  test('rejects garbage', () => {
    expect(() => parseSize('512')).toThrow()
    expect(() => parseSize('5 banana')).toThrow()
  })
})

describe('fromToml', () => {
  test('produces archinstall-shape JSON', () => {
    const cfg = fromToml(MINIMAL)
    expect(cfg.hostname).toBe('mark')
    expect(cfg.timezone).toBe('America/New_York')
    expect(cfg.kernels).toEqual(['linux'])
    expect(cfg.ntp).toBe(true)
    expect(cfg.locale_config).toEqual({ kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' })
    expect(cfg.bootloader_config).toEqual({ bootloader: 'Systemd-boot', uki: true, removable: false })
    expect(cfg.disk_config?.config_type).toBe('manual_partitioning')
    expect(cfg.disk_config?.device_modifications[0]?.device).toBe('/dev/vda')
    expect(cfg.network_config).toEqual({ type: 'iso' })
    expect(cfg.users).toEqual([{ username: 'spader', sudo: true, groups: ['wheel'], enc_password: null }])
    expect(cfg.packages).toEqual(['git', 'vim'])
    expect(cfg.mirror_config?.mirror_regions).toEqual({ 'United States': [] })
  })

  test('fills partition cruft', () => {
    const cfg = fromToml(MINIMAL)
    const p0 = cfg.disk_config!.device_modifications[0]!.partitions[0]!
    expect(p0.obj_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(p0.status).toBe('create')
    expect(p0.type).toBe('primary')
    expect(p0.btrfs).toEqual([])
    expect(p0.dev_path).toBeNull()
    expect(p0.mount_options).toEqual([])
    expect(p0.start.sector_size).toEqual({ unit: 'B', value: 512 })
  })

  test('derives start for non-first partition', () => {
    const cfg = fromToml(MINIMAL)
    const p1 = cfg.disk_config!.device_modifications[0]!.partitions[1]!
    expect(p1.start.unit).toBe('B')
    expect(p1.start.value).toBe(1024 ** 2 + 1024 ** 3)
  })

  test('rejects missing start on first partition', () => {
    const bad = MINIMAL.replace('  start = "1MiB"\n', '')
    expect(() => fromToml(bad)).toThrow(/first partition must specify start/)
  })

  test('rejects unknown fields', () => {
    expect(() => fromToml(MINIMAL + '\n[mystery]\nfoo = 1\n')).toThrow()
  })

  test('rejects invalid fs_type', () => {
    const bad = MINIMAL.replace('fs    = "fat32"', 'fs    = "exfat"')
    expect(() => fromToml(bad)).toThrow()
  })
})

describe('toToml', () => {
  test('round-trips through fromToml', () => {
    const cfg = fromToml(MINIMAL)
    const text = toToml(cfg)
    const cfg2 = fromToml(text)
    expect(cfg2.hostname).toBe(cfg.hostname)
    expect(cfg2.locale_config).toEqual(cfg.locale_config)
    expect(cfg2.bootloader_config).toEqual(cfg.bootloader_config)
    expect(cfg2.disk_config?.device_modifications[0]?.partitions[0]?.fs_type).toBe('fat32')
    expect(cfg2.disk_config?.device_modifications[0]?.partitions[1]?.size.unit).toBe('Percent')
    expect(cfg2.network_config).toEqual(cfg.network_config)
    expect(cfg2.mirror_config?.mirror_regions).toEqual({ 'United States': [] })
  })

  test('omits cruft from TOML output', () => {
    const cfg = fromToml(MINIMAL)
    const text = toToml(cfg)
    expect(text).not.toContain('obj_id')
    expect(text).not.toContain('status')
    expect(text).not.toContain('dev_path')
    expect(text).not.toContain('mount_options')
    expect(text).not.toContain('sector_size')
  })

  test('size formatting prefers human units', () => {
    const cfg = fromToml(MINIMAL)
    const text = toToml(cfg)
    expect(text).toContain('1GiB')
    expect(text).toContain('"rest"')
    expect(text).toContain('1MiB')
  })
})

describe('ArchinstallConfig schema', () => {
  test('accepts empty config', () => {
    expect(() => ArchinstallConfig.parse({})).not.toThrow()
  })
  test('rejects non-enum kernel', () => {
    expect(() => ArchinstallConfig.parse({ kernels: ['linux-bogus'] })).toThrow()
  })
})
