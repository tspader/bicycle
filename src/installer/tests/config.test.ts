import { describe, test, expect } from 'bun:test'
import { fromYaml, toYaml, testMachine, DEFAULT_MIRROR_URL, parseSize, sizeBytes, preflight, targetDevice } from '../src/config'
import type { DiskInfo } from '../src/system'

const ctx = () => testMachine({ disks: { '/dev/vda': 100 * 1024 ** 3 } }) // 100 GiB

const MINIMAL = `
core:
  hostname: mark
  timezone: America/New_York
  kernels: [linux]
  ntp: true

locale:
  keyboard: us
  language: en_US.UTF-8
  encoding: UTF-8

boot:
  loader: systemd-boot
  uki: true
  removable: false

disks:
  - device: /dev/vda
    wipe: true
    table: gpt
    partitions:
      - mount: /boot
        fs: fat32
        size: 1GiB
        start: 1MiB
        flags: [boot, esp]
      - mount: /
        fs: ext4
        size: 20GiB

swap:
  enabled: true
  algorithm: zstd

packages:
  extra: [git, vim]

pacman:
  mirrors:
    regions: [United States]

network:
  mode: iso
`

const importCfg = (text: string) => fromYaml(text, ctx()).config

test('fromYaml produces archinstall-shape JSON', () => {
  const cfg = importCfg(MINIMAL)
  expect(cfg.hostname).toBe('mark')
  expect(cfg.kernels).toEqual(['linux'])
  expect(cfg.locale_config).toEqual({ kb_layout: 'us', sys_lang: 'en_US.UTF-8', sys_enc: 'UTF-8' })
  expect(cfg.bootloader_config).toEqual({ bootloader: 'Systemd-boot', uki: true, removable: false })
  expect(cfg.disk_config?.config_type).toBe('manual_partitioning')
  expect(cfg.disk_config?.device_modifications[0]?.device).toBe('/dev/vda')
  expect(cfg.network_config).toEqual({ type: 'iso' })
  expect(cfg.packages).toEqual(['git', 'vim'])
  expect(cfg.mirror_config?.mirror_regions).toEqual({ 'United States': [DEFAULT_MIRROR_URL] })
})

test('testMachine produces deterministic obj_ids', () => {
  const cfg = importCfg(MINIMAL)
  const ids = cfg.disk_config!.device_modifications[0]!.partitions.map((p) => p.obj_id)
  expect(ids).toEqual([
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ])
})

test('derives start for non-first partition', () => {
  const cfg = importCfg(MINIMAL)
  const p1 = cfg.disk_config!.device_modifications[0]!.partitions[1]!
  expect(p1.start.unit).toBe('B')
  expect(p1.start.value).toBe(1024 ** 2 + 1024 ** 3)
})

test('"rest" on last partition resolves to remaining disk minus GPT tail', () => {
  const withRest = MINIMAL.replace('size: 20GiB', 'size: rest')
  const cfg = importCfg(withRest)
  const root = cfg.disk_config!.device_modifications[0]!.partitions[1]!
  const expected = 100 * 1024 ** 3 - 1024 ** 2 - 1024 ** 2 - 1024 ** 3
  expect(root.size).toEqual({ unit: 'B', value: expected, sector_size: { unit: 'B', value: 512 } })
})

test('"rest" only on last partition', () => {
  const bad = MINIMAL.replace('size: 1GiB', 'size: rest')
  expect(() => importCfg(bad)).toThrow(/only allowed on the last partition/)
})

test('toYaml -> fromYaml round-trips meaningful fields', () => {
  const a = importCfg(MINIMAL)
  const b = importCfg(toYaml(a))
  expect(b.hostname).toEqual(a.hostname)
  expect(b.locale_config).toEqual(a.locale_config)
  expect(b.bootloader_config).toEqual(a.bootloader_config)
  expect(b.network_config).toEqual(a.network_config)
  expect(b.packages).toEqual(a.packages)
  expect(b.mirror_config).toEqual(a.mirror_config)
  expect(b.swap).toEqual(a.swap)
  const pa = a.disk_config!.device_modifications[0]!.partitions
  const pb = b.disk_config!.device_modifications[0]!.partitions
  expect(pb.map((p) => ({ fs: p.fs_type, mount: p.mountpoint, flags: p.flags, size: p.size }))).toEqual(
    pa.map((p) => ({ fs: p.fs_type, mount: p.mountpoint, flags: p.flags, size: p.size })),
  )
})

test('uses plural YAML keys (disks/partitions)', () => {
  const cfg = importCfg(MINIMAL)
  expect(cfg.disk_config!.device_modifications).toHaveLength(1)
  expect(cfg.disk_config!.device_modifications[0]!.partitions).toHaveLength(2)
})

test('rejects obsolete singular keys (disk/partition)', () => {
  const bad = MINIMAL
    .replace('disks:', 'disk:')
    .replace('partitions:', 'partition:')
  expect(() => importCfg(bad)).toThrow()
})

test('rejects unknown nested fields', () => {
  const bad = MINIMAL.replace('keyboard: us', 'keyboard: us\n  typo_field: x')
  expect(() => importCfg(bad)).toThrow()
})

test('drops user blocks on import (passwords cannot be expressed in YAML)', () => {
  const withUser = MINIMAL + '\nusers:\n  - name: spader\n    sudo: true\n    groups: [wheel]\n'
  const cfg = importCfg(withUser)
  expect(cfg.users).toBeUndefined()
})

test('rejects nm_iwd network mode (archinstall silently drops it)', () => {
  const bad = MINIMAL.replace('mode: iso', 'mode: nm_iwd')
  expect(() => importCfg(bad)).toThrow()
})

test('retains catalog and systemd through import and preview serialization', () => {
  const withRetained = MINIMAL +
    '\ncatalog:\n  url: "git://localhost/bikeshop"\n' +
    'systemd:\n  enable: [docker.service]\n'
  const { config, retained } = fromYaml(withRetained, ctx())
  expect(retained.catalog?.url).toBe('git://localhost/bikeshop')
  expect(retained.systemd?.enable).toEqual(['docker.service'])

  const out = toYaml(config, retained)
  const reparsed = fromYaml(out, ctx())
  expect(reparsed.retained.catalog?.url).toBe('git://localhost/bikeshop')
  expect(reparsed.retained.systemd?.enable).toEqual(['docker.service'])
})

test('parses the checked-in example/machine/bicycle.yml', async () => {
  const text = await Bun.file(new URL('../../../example/machine/bicycle.yml', import.meta.url)).text()
  const { config, retained } = fromYaml(text, testMachine({ disks: { '/dev/vda': 32 * 1024 ** 3 } }))
  expect(config.hostname).toBeTruthy()
  expect(retained.catalog?.url).toBeTruthy()
  expect(retained.systemd?.enable?.length).toBeGreaterThan(0)
})

const WITH_BTRFS_ENC = `
disks:
  - device: /dev/vda
    wipe: true
    table: gpt
    partitions:
      - mount: /boot
        fs: fat32
        start: 1MiB
        size: 512MiB
        flags: [boot, esp]
      - mount: /
        fs: btrfs
        size: 20GiB
        mount_options: [compress=zstd, noatime]
        encrypt: true
        subvolumes:
          - name: "@"
            mount: /
          - name: "@home"
            mount: /home

encryption:
  type: luks
`

test('mount_options + btrfs subvolumes + encryption round-trip', () => {
  const a = importCfg(WITH_BTRFS_ENC)
  const root = a.disk_config!.device_modifications[0]!.partitions[1]!
  expect(root.mount_options).toEqual(['compress=zstd', 'noatime'])
  expect(root.btrfs).toEqual([
    { name: '@', mountpoint: '/' },
    { name: '@home', mountpoint: '/home' },
  ])
  expect(a.disk_config!.disk_encryption?.encryption_type).toBe('luks')
  expect(a.disk_config!.disk_encryption?.partitions).toEqual([root.obj_id])

  const b = importCfg(toYaml(a))
  const rootB = b.disk_config!.device_modifications[0]!.partitions[1]!
  expect(rootB.mount_options).toEqual(root.mount_options)
  expect(rootB.btrfs).toEqual(root.btrfs)
  expect(b.disk_config!.disk_encryption?.encryption_type).toBe('luks')
  expect(b.disk_config!.disk_encryption?.partitions).toEqual([rootB.obj_id])
})

test('rejects encrypt=true without encryption block', () => {
  const bad = WITH_BTRFS_ENC.replace(/\nencryption:\n  type: luks\n/, '')
  expect(() => importCfg(bad)).toThrow(/require an `encryption` block/)
})

test('rejects subvolumes on non-btrfs partition', () => {
  const bad = WITH_BTRFS_ENC.replace('fs: btrfs', 'fs: ext4')
  expect(() => importCfg(bad)).toThrow(/subvolumes requires fs="btrfs"/)
})

describe('parseSize', () => {
  const GIB = 1024 ** 3

  test.each([
    ['1GiB', 1 * GIB],
    ['1gib', 1 * GIB],
    ['1GIB', 1 * GIB],
    ['1GB',  1 * GIB],
    ['1gb',  1 * GIB],
    ['1G',   1 * GIB],
    ['1g',   1 * GIB],
    ['200GiB', 200 * GIB],
    ['200gb',  200 * GIB],
    ['  200 gb  ', 200 * GIB],
    ['1.5GiB', 1.5 * GIB],
    ['512MiB', 512 * 1024 ** 2],
    ['512mb',  512 * 1024 ** 2],
    ['1024KiB', 1024 * 1024],
    ['1k', 1024],
    ['100B', 100],
    ['1TiB', 1024 ** 4],
    ['2tb',  2 * 1024 ** 4],
  ])('accepts %s', (input, expectedBytes) => {
    expect(sizeBytes(parseSize(input))).toBe(expectedBytes)
  })

  test('normalizes to canonical IEC unit', () => {
    expect(parseSize('200gb').unit).toBe('GiB')
    expect(parseSize('1m').unit).toBe('MiB')
    expect(parseSize('1k').unit).toBe('KiB')
  })

  test.each(['', '   ', '1', 'GiB', '1 ZiB', '1PB', '1xb', '1 fish', 'abc', '1.GiB', '-1GiB'])(
    'rejects %s', (input) => {
      expect(() => parseSize(input)).toThrow()
    },
  )

  test('error message names the offending input', () => {
    expect(() => parseSize('1 fish')).toThrow(/fish/)
    expect(() => parseSize('garbage')).toThrow(/garbage/)
  })
})

describe('preflight', () => {
  const disks: DiskInfo[] = [
    { path: '/dev/vda', model: 'vda', size: 100 * 1024 ** 3, sectorSize: 512, isBoot: false },
  ]

  const ready = () => {
    const cfg = importCfg(MINIMAL.replace('size: 20GiB', 'size: rest'))
    return {
      ...cfg,
      users: [{ username: 's', sudo: true, groups: ['wheel'], enc_password: 'h' }],
    }
  }

  test('passes on a complete config', () => {
    expect(preflight(ready(), disks)).toEqual({ ok: true, problems: [] })
  })

  test('reports missing system fields', () => {
    const cfg = ready()
    delete cfg.hostname
    delete cfg.timezone
    cfg.kernels = []
    delete cfg.locale_config
    delete cfg.bootloader_config
    const r = preflight(cfg, disks)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/hostname/),
      expect.stringMatching(/timezone/),
      expect.stringMatching(/kernel/),
      expect.stringMatching(/locale/),
      expect.stringMatching(/bootloader/),
    ]))
  })

  test('requires a / mountpoint', () => {
    const cfg = ready()
    cfg.disk_config!.device_modifications[0]!.partitions = cfg.disk_config!.device_modifications[0]!.partitions
      .filter((p) => p.mountpoint !== '/')
    const r = preflight(cfg, disks)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => p.includes('"/"'))).toBe(true)
  })

  test('requires a sudo user or root password', () => {
    const cfg = ready()
    cfg.users = []
    cfg.root_enc_password = null
    const r = preflight(cfg, disks)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => p.toLowerCase().includes('sudo'))).toBe(true)
  })

  test('flags overflow', () => {
    const small: DiskInfo[] = [{ path: '/dev/vda', model: 'vda', size: 10 * 1024 ** 3, sectorSize: 512, isBoot: false }]
    const r = preflight(ready(), small)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => /total .* B but disk is/.test(p))).toBe(true)
  })

  test('targetDevice returns the first wiping device', () => {
    expect(targetDevice(ready())).toBe('/dev/vda')
  })
})

describe('ArchinstallConfig schema', () => {
  test('rejects user without password (archinstall silently skips them)', async () => {
    const { ArchinstallConfig } = await import('../src/config')
    expect(() => ArchinstallConfig.parse({
      users: [{ username: 'x', sudo: true, groups: [], enc_password: '' }],
    })).toThrow()
  })
})
