import { test, expect, beforeAll, afterAll } from 'bun:test'
import { chromium, type Browser, type Page } from 'playwright-core'

const CHROMIUM = '/usr/bin/chromium'
const TIMEOUT = 20_000

type UiAction =
  | { goto: string }
  | { click: string }
  | { fill: { sel: string; value: string } }
  | { select: { sel: string; value: string } }
  | { press: { sel: string; key: string } }
  | { wait: number }

type UiExpect = {
  yaml?: string[]
  notYaml?: string[]
  text?: { sel: string; contains: string }[]
  value?: { sel: string; equals: string }[]
  visible?: string[]
  absent?: string[]
}

type UiTest = {
  actions: UiAction[]
  expect: UiExpect
}

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
})

afterAll(async () => {
  await browser?.close()
})

// A stale server squatting on the port would serve old code and leftover
// state, so probe for a port nothing answers on before binding it.
const freePort = async (): Promise<number> => {
  for (;;) {
    const port = 17_000 + Math.floor(Math.random() * 8_000)
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(250) })
    } catch {
      return port
    }
  }
}

const startServer = async (port: number) => {
  const proc = Bun.spawn(['bun', 'src/server.tsx'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const deadline = Date.now() + 10_000
  for (;;) {
    if (proc.exitCode != null) throw new Error(`server exited with ${proc.exitCode}`)
    try {
      const res = await fetch(`http://localhost:${port}/config/system`)
      if (res.ok) return proc
    } catch {}
    if (Date.now() > deadline) {
      proc.kill()
      throw new Error('server did not come up')
    }
    await Bun.sleep(50)
  }
}

const waitFor = async (fn: () => Promise<boolean>, what: string): Promise<void> => {
  const deadline = Date.now() + 4_000
  for (;;) {
    if (await fn()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(100)
  }
}

const previewText = (page: Page): Promise<string> =>
  page.locator('#config-preview .preview-body').innerText()

const runAction = async (page: Page, base: string, a: UiAction): Promise<void> => {
  if ('goto' in a) {
    await page.goto(base + a.goto)
    return
  }
  if ('click' in a) {
    await page.click(a.click)
  } else if ('fill' in a) {
    await page.fill(a.fill.sel, a.fill.value)
    await page.dispatchEvent(a.fill.sel, 'change')
  } else if ('select' in a) {
    await page.selectOption(a.select.sel, a.select.value)
  } else if ('press' in a) {
    await page.press(a.press.sel, a.press.key)
  } else if ('wait' in a) {
    await Bun.sleep(a.wait)
    return
  }
  await Bun.sleep(150)
}

const runExpect = async (page: Page, e: UiExpect): Promise<void> => {
  for (const s of e.yaml ?? []) {
    await waitFor(async () => (await previewText(page)).includes(s), `yaml to contain ${JSON.stringify(s)}`)
  }
  for (const s of e.notYaml ?? []) {
    await waitFor(async () => !(await previewText(page)).includes(s), `yaml to drop ${JSON.stringify(s)}`)
  }
  for (const t of e.text ?? []) {
    await waitFor(
      async () => ((await page.locator(t.sel).innerText({ timeout: 500 }).catch(() => '')) ?? '').includes(t.contains),
      `${t.sel} to contain ${JSON.stringify(t.contains)}`,
    )
  }
  for (const v of e.value ?? []) {
    await waitFor(
      async () => (await page.locator(v.sel).inputValue({ timeout: 500 }).catch(() => null)) === v.equals,
      `${v.sel} to have value ${JSON.stringify(v.equals)}`,
    )
  }
  for (const sel of e.visible ?? []) {
    await waitFor(() => page.locator(sel).isVisible().catch(() => false), `${sel} to be visible`)
  }
  for (const sel of e.absent ?? []) {
    await waitFor(async () => (await page.locator(sel).count()) === 0, `${sel} to be absent`)
  }
}

const runUiTest = async (t: UiTest): Promise<void> => {
  const port = await freePort()
  const proc = await startServer(port)
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  try {
    for (const a of t.actions) await runAction(page, `http://localhost:${port}`, a)
    await runExpect(page, t.expect)
    expect(errors).toEqual([])
  } finally {
    await context.close()
    proc.kill()
    await proc.exited
  }
}

const ADD_USER: UiAction[] = [{ goto: '/config/users' }, { click: '#add-user' }]

const CASES: Record<string, UiTest> = {
  'hostname edit lands in yaml': {
    actions: [{ goto: '/config/system' }, { fill: { sel: '#hostname', value: 'testbox' } }],
    expect: { yaml: ['hostname: testbox'] },
  },
  'clearing hostname keeps the last valid value with a message': {
    actions: [
      { goto: '/config/system' },
      { fill: { sel: '#hostname', value: '' } },
      { wait: 600 },
    ],
    expect: {
      text: [{ sel: '#hostname-status', contains: 'hostname required' }],
      yaml: ['hostname: bicycle'],
    },
  },
  'ntp switch toggles yaml': {
    actions: [{ goto: '/config/system' }, { click: '#ntp' }],
    expect: { yaml: ['ntp: false'] },
  },
  'timezone select lands in yaml': {
    actions: [{ goto: '/config/system' }, { select: { sel: '#timezone', value: 'Europe/Berlin' } }],
    expect: { yaml: ['timezone: Europe/Berlin'] },
  },
  'network mode select maps to networkmanager': {
    actions: [{ goto: '/config/system' }, { select: { sel: '#mode', value: 'nm' } }],
    expect: { yaml: ['mode: networkmanager'] },
  },
  'keyboard layout select lands in yaml': {
    actions: [{ goto: '/config/system' }, { select: { sel: '#kb_layout', value: 'de' } }],
    expect: { yaml: ['keyboard: de'] },
  },
  'bootloader select lands in yaml': {
    actions: [{ goto: '/config/boot' }, { select: { sel: '#loader', value: 'grub' } }],
    expect: { yaml: ['loader: grub'] },
  },
  'uki switch toggles yaml': {
    actions: [{ goto: '/config/boot' }, { click: '#uki' }],
    expect: { yaml: ['uki: false'] },
  },
  'kernel select lands in yaml': {
    actions: [{ goto: '/config/boot' }, { select: { sel: '#kernel', value: 'linux-lts' } }],
    expect: { yaml: ['kernels: [linux-lts]'] },
  },
  'swap algorithm select lands in yaml': {
    actions: [{ goto: '/config/disk' }, { select: { sel: '#algorithm', value: 'lz4' } }],
    expect: { yaml: ['algorithm: lz4'] },
  },
  'swap switch toggles yaml': {
    actions: [{ goto: '/config/disk' }, { click: '#enabled' }],
    expect: { yaml: ['enabled: false'] },
  },
  'added user appears in table and yaml': {
    actions: ADD_USER,
    expect: {
      yaml: ['users:', 'name: user'],
      text: [{ sel: '#user-row-0', contains: 'user' }],
      visible: ['#u-name'],
    },
  },
  'rename updates table row and yaml without reload': {
    actions: [...ADD_USER, { fill: { sel: '#u-name', value: 'alice' } }, { wait: 600 }],
    expect: {
      yaml: ['name: alice'],
      text: [{ sel: '#user-row-0', contains: 'alice' }],
    },
  },
  'group add via enter shows chip, row, and yaml': {
    actions: [...ADD_USER, { fill: { sel: '.chip-input', value: 'wheel' } }, { press: { sel: '.chip-input', key: 'Enter' } }],
    expect: {
      yaml: ['groups: [wheel]'],
      text: [
        { sel: '#user-groups-0', contains: 'wheel' },
        { sel: '#user-row-0', contains: 'wheel' },
      ],
    },
  },
  'password stages a secret ref and marks the row': {
    actions: [...ADD_USER, { fill: { sel: '#u-pw', value: 'hunter2' } }, { wait: 600 }],
    expect: {
      yaml: ['password: ${secret:users/user/password}'],
      text: [{ sel: '#user-row-0', contains: '✓' }],
    },
  },
  'sudo select updates table row and yaml': {
    actions: [...ADD_USER, { select: { sel: '#u-sudo', value: 'passwordless' } }],
    expect: {
      yaml: ['sudo: passwordless'],
      text: [{ sel: '#user-row-0', contains: 'passwordless' }],
    },
  },
  'removing the user empties table and yaml': {
    actions: [...ADD_USER, { click: '#user-remove' }],
    expect: {
      notYaml: ['users:'],
      absent: ['#user-row-0', '#u-name'],
      text: [{ sel: '.users-table', contains: 'No accounts yet' }],
    },
  },
  'panel repoints cleanly to a freshly added second user': {
    actions: [
      ...ADD_USER,
      { fill: { sel: '.chip-input', value: 'wheel' } },
      { press: { sel: '.chip-input', key: 'Enter' } },
      { click: '#add-user' },
      { wait: 300 },
    ],
    expect: {
      value: [{ sel: '#u-name', equals: 'user2' }],
      text: [{ sel: '#user-groups-1', contains: 'No extra groups' }],
      yaml: ['name: user2'],
    },
  },
  'duplicate rename is rejected with an inline message': {
    actions: [
      ...ADD_USER,
      { click: '#add-user' },
      { fill: { sel: '#u-name', value: 'user' } },
      { wait: 600 },
    ],
    expect: {
      text: [
        { sel: '#user-name-status', contains: 'already taken' },
        { sel: '#user-row-1', contains: 'user2' },
      ],
      yaml: ['name: user2'],
    },
  },
  'root password save reports status': {
    actions: [
      { goto: '/config/users' },
      { fill: { sel: '#root-pw', value: 'toor' } },
      { wait: 600 },
    ],
    expect: { text: [{ sel: '#root-status', contains: '✓ root password set' }] },
  },
  'mirror region toggle lands in yaml': {
    actions: [{ goto: '/config/pacman' }, { click: '#region-belgium' }],
    expect: { yaml: ['regions: [Belgium]'] },
  },
  'mirror region untoggle prunes the pacman block': {
    actions: [{ goto: '/config/pacman' }, { click: '#region-belgium' }, { wait: 300 }, { click: '#region-belgium' }],
    expect: { notYaml: ['regions:', 'pacman:'] },
  },
  'package checkbox lands in yaml': {
    actions: [{ goto: '/config/pacman' }, { click: '#pkg-row-7zip input.pkg-check' }],
    expect: { yaml: ['extra: [7zip]'] },
  },
  'package row click opens detail pane': {
    actions: [{ goto: '/config/pacman' }, { click: '#pkg-row-7zip td.col-name' }],
    expect: { text: [{ sel: '#package-detail', contains: '7zip' }] },
  },
  'package filter narrows the list': {
    actions: [{ goto: '/config/pacman' }, { fill: { sel: '.pkg-toolbar input.combo', value: 'neovim' } }, { wait: 500 }],
    expect: { visible: ['#pkg-row-neovim'], absent: ['#pkg-row-0ad'] },
  },
  'bogus age identity shows an inline error': {
    actions: [
      { goto: '/config/import' },
      { fill: { sel: '#age-identity-input', value: 'bogus' } },
      { click: '#age-save' },
    ],
    expect: { text: [{ sel: '#age-error', contains: 'identity' }] },
  },
  'valid age identity shows the set chip and clears warnings': {
    actions: [
      { goto: '/config/import' },
      { fill: { sel: '#age-identity-input', value: 'AGE-SECRET-KEY-1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } },
      { click: '#age-save' },
    ],
    expect: { text: [{ sel: '#age-section', contains: 'identity set' }] },
  },
  'install page blocks on preflight problems': {
    actions: [{ goto: '/install' }],
    expect: { text: [{ sel: '.page', contains: 'Not ready' }] },
  },
}

for (const [name, t] of Object.entries(CASES)) {
  test(name, () => runUiTest(t), TIMEOUT)
}

test('btrfs preset subvolume mounts do not false-positive the uniqueness check', async () => {
  const port = await freePort()
  const proc = await startServer(port)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`http://localhost:${port}/config/disk`)
    await page.locator('.disks-table tbody tr.row').first().click()
    await page.click('#preset-btrfs_subvols')
    await waitFor(async () => (await previewText(page)).includes('subvolumes:'), 'subvolumes in yaml')
    const warnings = await page.locator('#config-warnings').innerText({ timeout: 1000 }).catch(() => '')
    expect(warnings).not.toContain('mounted')
  } finally {
    await context.close()
    proc.kill()
    await proc.exited
  }
}, TIMEOUT)

test('disk preset builds a layout for the first detected disk', async () => {
  const port = await freePort()
  const proc = await startServer(port)
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`http://localhost:${port}/config/disk`)
    const firstRow = page.locator('.disks-table tbody tr.row').first()
    const device = (await firstRow.locator('td').first().innerText()).trim()
    await firstRow.click()
    await page.click('#preset-single_root')
    await waitFor(async () => (await previewText(page)).includes(`device: ${device}`), 'device in yaml')
    await waitFor(async () => (await previewText(page)).includes('mount: /boot'), 'boot partition in yaml')
    await page.click('#partition-add')
    await waitFor(
      async () => (await page.locator('.partition-table tbody tr.partition-row').count()) === 3,
      'added partition row',
    )
    const newMount = page.locator('.partition-table tbody tr.partition-row').nth(1).locator('input').first()
    await newMount.fill('/')
    await newMount.dispatchEvent('change')
    await waitFor(
      async () => (await page.locator('#config-warnings').innerText({ timeout: 500 }).catch(() => '')).includes('mounted 2 times'),
      'duplicate mount warning',
    )
  } finally {
    await context.close()
    proc.kill()
    await proc.exited
  }
}, TIMEOUT)
