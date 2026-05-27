import { describe, test, expect } from 'bun:test'
import { AgeIdentityString } from '../src/age-key'
import { deriveWarnings, fromToml, testMachine } from '../src/config'
import type { DiskInfo } from '../src/system'

const ctx = () => testMachine({ disks: { '/dev/vda': 100 * 1024 ** 3 } })

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

[packages]
extra = ["git"]

[pacman.mirrors]
regions = ["United States"]
`

const GOOD_X25519 = 'AGE-SECRET-KEY-1' + 'A'.repeat(58)
const GOOD_PQ = 'AGE-SECRET-KEY-PQ-1' + 'B'.repeat(60)

describe('AgeIdentityString', () => {
  test('accepts AGE-SECRET-KEY-1 identity', () => {
    const r = AgeIdentityString.safeParse(GOOD_X25519)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe(GOOD_X25519)
  })

  test('accepts post-quantum identity AGE-SECRET-KEY-PQ-1', () => {
    const r = AgeIdentityString.safeParse(GOOD_PQ)
    expect(r.success).toBe(true)
  })

  test('trims surrounding whitespace before validation', () => {
    const r = AgeIdentityString.safeParse(`  ${GOOD_X25519}\n`)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toBe(GOOD_X25519)
  })

  test('rejects wrong prefix', () => {
    const r = AgeIdentityString.safeParse('AGE-PUBLIC-KEY-1' + 'A'.repeat(60))
    expect(r.success).toBe(false)
  })

  test('rejects too short', () => {
    const r = AgeIdentityString.safeParse('AGE-SECRET-KEY-1short')
    expect(r.success).toBe(false)
  })

  test('rejects non-ASCII', () => {
    const r = AgeIdentityString.safeParse('AGE-SECRET-KEY-1' + 'A'.repeat(50) + 'é')
    expect(r.success).toBe(false)
  })

  test('rejects empty string', () => {
    expect(AgeIdentityString.safeParse('').success).toBe(false)
  })
})

describe('deriveWarnings age-key', () => {
  const disks: DiskInfo[] = [
    { path: '/dev/vda', model: 'vda', size: 100 * 1024 ** 3, sectorSize: 512, isBoot: false },
  ]
  const ready = () => {
    const cfg = fromToml(MINIMAL, ctx())
    return {
      ...cfg,
      users: [{ username: 's', sudo: true, groups: ['wheel'], enc_password: 'h' }],
    }
  }

  test('emits a warning (not an error) when no age key is set', () => {
    const ws = deriveWarnings(ready(), disks, null)
    const ageWarnings = ws.filter((w) => /age identity/i.test(w.message))
    expect(ageWarnings.length).toBe(1)
    expect(ageWarnings[0]!.severity).toBe('warning')
    expect(ageWarnings[0]!.category).toBe('import')
  })

  test('no age-key warning when a key is set', () => {
    const ws = deriveWarnings(ready(), disks, GOOD_X25519)
    expect(ws.some((w) => /age identity/i.test(w.message))).toBe(false)
  })
})
