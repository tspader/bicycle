import { describe, test, expect } from 'bun:test'
import { fromYaml, testMachine, DEFAULT_MIRROR_URL, parseSize, sizeBytes, preflight, targetDevice } from '../src/config'
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

const importCfg = (text: string) => fromYaml(text, ctx())

test('project produces archinstall-shape JSON', () => {
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

test('project never folds users into the archinstall config (the daemon creates them)', () => {
  const withUser = MINIMAL +
    '\nusers:\n  - name: spader\n    sudo: password\n    groups: [wheel]\n    password: ${secret:users/spader/password}\n'
  const cfg = importCfg(withUser)
  expect(cfg.users).toBeUndefined()
})

test('resolves vars before projecting', () => {
  const withVars = MINIMAL +
    '\nvars:\n  media:\n    gid: 1001\n' +
    'groups:\n  - name: media\n    gid: ${media.gid}\n'
  // groups don't reach the archinstall projection, but the vars table must
  // still resolve without error (a bad ref would throw).
  expect(() => importCfg(withVars)).not.toThrow()
})

test('rejects nm_iwd network mode (archinstall silently drops it)', () => {
  const bad = MINIMAL.replace('mode: iso', 'mode: nm_iwd')
  expect(() => importCfg(bad)).toThrow()
})

test('projects the checked-in example/machine/bicycle.yml', async () => {
  const text = await Bun.file(new URL('../../../example/machine/bicycle.yml', import.meta.url)).text()
  const cfg = fromYaml(text, testMachine({ disks: { '/dev/vda': 32 * 1024 ** 3 } }))
  expect(cfg.hostname).toBeTruthy()
  expect(cfg.disk_config?.device_modifications[0]?.device).toBe('/dev/vda')
  expect(cfg.users).toBeUndefined()
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

test('mount_options + btrfs subvolumes + encryption project correctly', () => {
  const a = importCfg(WITH_BTRFS_ENC)
  const root = a.disk_config!.device_modifications[0]!.partitions[1]!
  expect(root.mount_options).toEqual(['compress=zstd', 'noatime'])
  expect(root.btrfs).toEqual([
    { name: '@', mountpoint: '/' },
    { name: '@home', mountpoint: '/home' },
  ])
  expect(a.disk_config!.disk_encryption?.encryption_type).toBe('luks')
  expect(a.disk_config!.disk_encryption?.partitions).toEqual([root.obj_id])
})

test('rejects encrypt=true without encryption block', () => {
  const bad = WITH_BTRFS_ENC.replace(/\nencryption:\n  type: luks\n/, '')
  expect(() => importCfg(bad)).toThrow(/require an `encryption` block/)
})

test('rejects encryption block without an encrypted partition', () => {
  const bad = WITH_BTRFS_ENC.replace('        encrypt: true\n', '')
  expect(() => importCfg(bad)).toThrow(/at least one partition with encrypt=true/)
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
  const ageKey = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)
  const sudoer = { name: 'u', sudo: 'password' as const, hasPassword: true }

  const ready = () => importCfg(MINIMAL.replace('size: 20GiB', 'size: rest'))
  const okCtx = { identity: ageKey, accounts: [sudoer] }

  test('passes on a complete config', () => {
    expect(preflight(ready(), disks, okCtx)).toEqual({ ok: true, problems: [] })
  })

  test('reports missing system fields', () => {
    const cfg = ready()
    delete cfg.hostname
    delete cfg.timezone
    cfg.kernels = []
    delete cfg.locale_config
    delete cfg.bootloader_config
    const r = preflight(cfg, disks, okCtx)
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
    const dm = cfg.disk_config!.device_modifications[0]!
    dm.partitions = dm.partitions.filter((p) => p.mountpoint !== '/')
    const r = preflight(cfg, disks, okCtx)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => p.includes('"/"'))).toBe(true)
  })

  test('requires a sudo user or root password', () => {
    const r = preflight(ready(), disks, { identity: ageKey, accounts: [] })
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => p.toLowerCase().includes('sudo'))).toBe(true)
  })

  test('a root password satisfies the login requirement', () => {
    expect(preflight(ready(), disks, { identity: ageKey, rootSet: true })).toEqual({ ok: true, problems: [] })
  })

  test('a sudoer with a password + age key satisfies the login requirement', () => {
    expect(preflight(ready(), disks, { identity: ageKey, accounts: [sudoer] })).toEqual({ ok: true, problems: [] })
  })

  test('a sudoer with a password but NO age key errors on the age identity, once', () => {
    const r = preflight(ready(), disks, { identity: null, accounts: [sudoer] })
    if (r.ok) throw new Error('expected failure')
    const loginProblems = r.problems.filter(
      (p) => /age identity/i.test(p) || /sudo user/i.test(p),
    )
    expect(loginProblems).toHaveLength(1)
    expect(loginProblems[0]).toMatch(/age identity/i)
  })

  test('a non-sudo account does not satisfy the requirement', () => {
    const r = preflight(ready(), disks, { identity: ageKey, accounts: [{ name: 'u', sudo: 'none', hasPassword: true }] })
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => /sudo user/i.test(p))).toBe(true)
  })

  test('flags overflow', () => {
    const small: DiskInfo[] = [{ path: '/dev/vda', model: 'vda', size: 10 * 1024 ** 3, sectorSize: 512, isBoot: false }]
    const r = preflight(ready(), small, okCtx)
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => /total .* B but disk is/.test(p))).toBe(true)
  })

  test('encrypted partition without a LUKS password errors', () => {
    const cfg = importCfg(WITH_BTRFS_ENC.replace('size: 20GiB', 'size: rest'))
    const r = preflight(cfg, disks, { identity: ageKey, rootSet: true, encryptionSet: false })
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => /encryption password/i.test(p))).toBe(true)
  })

  test('targetDevice returns the first device', () => {
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
