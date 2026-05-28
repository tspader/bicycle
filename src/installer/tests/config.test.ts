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

test('fromYaml does not place YAML users into archinstall config (promoted separately at install)', () => {
  // YAML users carry password *secret refs*, not hashes, so fromYaml leaves
  // archinstall `users` empty. promoteUsers() decrypts + hashes them at
  // install time instead (see users-promote.ts). The user is still recorded
  // in the on-disk bicycle.yml for the daemon to reconcile.
  const withUser = MINIMAL +
    '\nusers:\n  - name: spader\n    sudo: password\n    groups: [wheel]\n    password: ${secret:users/spader/password}\n'
  const cfg = importCfg(withUser)
  expect(cfg.users).toBeUndefined()
})

test('toYaml emits a password secret ref for each archinstall user', () => {
  const cfg = importCfg(MINIMAL)
  cfg.users = [{ username: 'spader', sudo: true, groups: ['wheel'], enc_password: '$6$x' }]
  const out = toYaml(cfg)
  expect(out).toContain('${secret:users/spader/password}')
  // The hash is never serialized into the (world-readable) bicycle.yml.
  expect(out).not.toContain('$6$x')
})

test('toYaml preserves imported users (refs + uid) when the config is regenerated', () => {
  // Reproduces the dirty-import bug: a UI edit marks the source dirty, so
  // install regenerates bicycle.yml via toYaml instead of copying source
  // verbatim. Imported users must survive that round-trip.
  const withUser = MINIMAL +
    '\nusers:\n  - name: spader\n    uid: 1000\n    sudo: password\n    groups: [wheel]\n' +
    '    password: ${secret:users/spader/password}\n'
  const { config, retained } = fromYaml(withUser, ctx())
  expect(config.users).toBeUndefined() // not folded into archinstall config
  expect(retained.users?.[0]?.name).toBe('spader')

  const out = toYaml(config, retained)
  expect(out).toContain('name: spader')
  expect(out).toContain('uid: 1000')
  expect(out).toContain('${secret:users/spader/password}')

  const reparsed = fromYaml(out, ctx())
  expect(reparsed.retained.users?.[0]?.name).toBe('spader')
  expect(reparsed.retained.users?.[0]?.uid).toBe(1000)
  expect(reparsed.retained.users?.[0]?.password).toBe('${secret:users/spader/password}')
})

test('toYaml merges imported + UI users, UI winning on name conflict', () => {
  const withUser = MINIMAL +
    '\nusers:\n  - name: imported\n    sudo: none\n    groups: [g]\n' +
    '    password: ${secret:users/imported/password}\n' +
    '  - name: spader\n    uid: 1000\n    sudo: none\n    groups: [old]\n' +
    '    password: ${secret:users/spader/password}\n'
  const { config, retained } = fromYaml(withUser, ctx())
  config.users = [{ username: 'spader', sudo: true, groups: ['wheel'], enc_password: '$6$x' }]

  const reparsed = fromYaml(toYaml(config, retained), ctx())
  const users = reparsed.retained.users!
  // Both the untouched import and the UI override survive; no duplicate.
  expect(users.map((u) => u.name).sort()).toEqual(['imported', 'spader'])
  const spader = users.find((u) => u.name === 'spader')!
  expect(spader.sudo).toBe('password') // UI value (mapped from on), not the imported none
  expect(spader.groups).toEqual(['wheel'])
  expect(spader.uid).toBeUndefined() // UI users have no uid
  expect(spader.password).toBe('${secret:users/spader/password}')
})

test('toYaml preserves daemon-only groups + dirs through a dirty regenerate', () => {
  // groups.ts / dirs.ts reconcile these on the installed system; archinstall
  // doesn't model them, so they must round-trip via retained (vars resolved).
  const withExtras = MINIMAL +
    '\ngroups:\n  - name: media\n    gid: ${media.gid}\n' +
    'dirs:\n  - path: /media\n    group: media\n    mode: "02775"\n' +
    'vars:\n  media:\n    gid: 1001\n'
  const { config, retained } = fromYaml(withExtras, ctx())
  expect(retained.groups?.[0]).toEqual({ name: 'media', gid: 1001 })

  const reparsed = fromYaml(toYaml(config, retained), ctx())
  expect(reparsed.retained.groups?.[0]).toEqual({ name: 'media', gid: 1001 })
  expect(reparsed.retained.dirs?.[0]).toEqual({ path: '/media', group: 'media', mode: '02775' })
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

  const noLogin = () => {
    const cfg = ready()
    cfg.users = []
    cfg.root_enc_password = null
    return cfg
  }
  const pendingSudoer = [{ sudo: true, hasPassword: true }]
  const ageKey = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)

  test('a promotable YAML sudoer + age key satisfies the login requirement', () => {
    expect(preflight(noLogin(), disks, ageKey, pendingSudoer)).toEqual({ ok: true, problems: [] })
  })

  test('promotable YAML sudoer WITHOUT an age key errors on the age identity, once', () => {
    const r = preflight(noLogin(), disks, null, pendingSudoer)
    if (r.ok) throw new Error('expected failure')
    const loginProblems = r.problems.filter(
      (p) => /age identity/i.test(p) || /sudo user or set a root/i.test(p),
    )
    // Exactly one login-related error, and it's the actionable age one.
    expect(loginProblems).toHaveLength(1)
    expect(loginProblems[0]).toMatch(/age identity/i)
  })

  test('a non-sudo pending user does not satisfy the requirement', () => {
    const r = preflight(noLogin(), disks, ageKey, [{ sudo: false, hasPassword: true }])
    if (r.ok) throw new Error('expected failure')
    expect(r.problems.some((p) => /sudo user or set a root/i.test(p))).toBe(true)
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
