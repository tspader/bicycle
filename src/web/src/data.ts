import { spawn, env, readFile } from './runtime'

export type KbLayout = string
export type Locale = { lang: string; enc: string }

export const KERNELS = ['linux', 'linux-lts', 'linux-zen', 'linux-hardened'] as const
export type Kernel = (typeof KERNELS)[number]

export async function listKbLayouts(): Promise<KbLayout[]> {
  const proc = spawn(['localectl', '--no-pager', 'list-keymaps'], {
    stdout: 'pipe',
    env: { ...env, SYSTEMD_COLORS: '0' },
  })
  const text = await new Response(proc.stdout).text()
  return text.split('\n').map((s) => s.trim()).filter(Boolean).sort()
}

export async function listLocales(): Promise<Locale[]> {
  // const raw = await readFile('/usr/share/i18n/SUPPORTED', 'utf8')
  const raw = ''
  const out: Locale[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'C.UTF-8 UTF-8') continue
    const [lang, enc] = trimmed.split(/\s+/)
    if (lang && enc) out.push({ lang, enc })
  }
  return out
}

export function listLanguages(locales: Locale[]): string[] {
  const set = new Set(locales.map((l) => l.lang))
  return [...set].sort()
}

export function listEncodings(locales: Locale[]): string[] {
  const set = new Set(locales.map((l) => l.enc))
  return [...set].sort()
}
