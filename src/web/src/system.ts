import { spawn, env, readFile } from './runtime'

export type KbLayout = string
export type Locale = { lang: string; enc: string }
export type Region = string
export type PackageEntry = { repo: string; name: string; version: string; installed: boolean }
export type PackageDetail = {
  name: string
  version: string
  repo: string
  description: string
  url: string
  installed_size: string
  depends: string[]
}

export const KERNELS = ['linux', 'linux-lts', 'linux-zen', 'linux-hardened'] as const
export type Kernel = (typeof KERNELS)[number]

const runText = async (args: string[]): Promise<string> => {
  const proc = spawn(args, {
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...env, SYSTEMD_COLORS: '0', LC_ALL: 'C' },
  })
  return await new Response(proc.stdout).text()
}

export const kbLayouts = async (): Promise<KbLayout[]> => {
  const text = await runText(['localectl', '--no-pager', 'list-keymaps'])
  return text.split('\n').map((s) => s.trim()).filter(Boolean).sort()
}

export const locales = async (): Promise<Locale[]> => {
  let raw = ''
  try {
    raw = new TextDecoder().decode(await readFile('/usr/share/i18n/SUPPORTED'))
  } catch {
    raw = ''
  }
  const out: Locale[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === 'C.UTF-8 UTF-8' || trimmed.startsWith('#')) continue
    const [lang, enc] = trimmed.split(/\s+/)
    if (lang && enc) out.push({ lang, enc })
  }
  return out
}

export const languages = (l: Locale[]): string[] => [...new Set(l.map((x) => x.lang))].sort()
export const encodings = (l: Locale[]): string[] => [...new Set(l.map((x) => x.enc))].sort()

export const timezones = async (): Promise<string[]> => {
  const text = await runText(['timedatectl', 'list-timezones'])
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

const REGIONS = [
  'Australia', 'Austria', 'Bangladesh', 'Belarus', 'Belgium', 'Brazil', 'Bulgaria',
  'Canada', 'Chile', 'China', 'Colombia', 'Croatia', 'Czechia', 'Denmark',
  'Ecuador', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hong Kong',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Ireland', 'Israel',
  'Italy', 'Japan', 'Kazakhstan', 'Kenya', 'Latvia', 'Lithuania', 'Luxembourg',
  'Mexico', 'Moldova', 'Netherlands', 'New Caledonia', 'New Zealand', 'Norway',
  'Pakistan', 'Paraguay', 'Philippines', 'Poland', 'Portugal', 'Romania',
  'Russia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa',
  'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand',
  'Turkey', 'Ukraine', 'United Kingdom', 'United States', 'Vietnam', 'Worldwide',
]
export const regions = (): Region[] => REGIONS

let packageCache: PackageEntry[] | null = null

export const loadPackages = async (): Promise<PackageEntry[]> => {
  if (packageCache) return packageCache
  const text = await runText(['pacman', '-Sl'])
  const out: PackageEntry[] = []
  for (const line of text.split('\n')) {
    const parts = line.split(' ')
    if (parts.length < 3) continue
    const [repo, name, version, ...rest] = parts
    if (!repo || !name || !version) continue
    out.push({ repo, name, version, installed: rest.join(' ').includes('[installed]') })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  packageCache = out
  return out
}

export type PackagePage = { items: PackageEntry[]; next: string | null }

export const availableRepos = async (): Promise<string[]> => {
  const all = await loadPackages()
  return [...new Set(all.map((p) => p.repo))].sort()
}

export const searchPackages = async (opts: {
  q?: string
  after?: string
  limit?: number
  selected?: Set<string>
  repos?: string[]
}): Promise<PackagePage> => {
  const all = await loadPackages()
  const q = (opts.q ?? '').trim().toLowerCase()
  const limit = opts.limit ?? 50
  const selected = opts.selected ?? new Set<string>()
  const repoFilter = opts.repos ? new Set(opts.repos) : null

  let phase: 's' | 'u' = 's'
  let after = ''
  if (opts.after) {
    const colon = opts.after.indexOf(':')
    if (colon > 0) {
      phase = opts.after.slice(0, colon) as 's' | 'u'
      after = opts.after.slice(colon + 1)
    }
  }

  const matched = all.filter(
    (p) => (!repoFilter || repoFilter.has(p.repo)) && (!q || p.name.toLowerCase().includes(q)),
  )
  const sel: PackageEntry[] = []
  const uns: PackageEntry[] = []
  for (const p of matched) (selected.has(p.name) ? sel : uns).push(p)

  const items: PackageEntry[] = []
  let nextCursor: string | null = null

  const take = (arr: PackageEntry[], startAfter: string, tag: 's' | 'u'): boolean => {
    for (const p of arr) {
      if (startAfter && p.name <= startAfter) continue
      if (items.length >= limit) {
        nextCursor = `${tag}:${items[items.length - 1]!.name}`
        return true
      }
      items.push(p)
    }
    return false
  }

  if (phase === 's') {
    if (!take(sel, after, 's')) take(uns, '', 'u')
  } else {
    take(uns, after, 'u')
  }

  if (!nextCursor && items.length === limit) {
    nextCursor = `u:${items[items.length - 1]!.name}`
  }

  return { items, next: nextCursor }
}

export const packageDetail = async (name: string): Promise<PackageDetail | null> => {
  const text = await runText(['pacman', '-Si', name])
  if (!text.trim()) return null
  const fields: Record<string, string> = {}
  let lastKey: string | null = null
  for (const line of text.split('\n')) {
    const m = /^([A-Z][A-Za-z ]+?)\s*:\s*(.*)$/.exec(line)
    if (m) {
      lastKey = m[1]!.trim()
      fields[lastKey] = m[2]!.trim()
    } else if (lastKey && line.startsWith(' ')) {
      fields[lastKey] = `${fields[lastKey] ?? ''} ${line.trim()}`.trim()
    }
  }
  if (!fields['Name']) return null
  const depends = (fields['Depends On'] ?? '').split(/\s+/).filter((s) => s && s !== 'None')
  return {
    name: fields['Name']!,
    version: fields['Version'] ?? '',
    repo: fields['Repository'] ?? '',
    description: fields['Description'] ?? '',
    url: fields['URL'] ?? '',
    installed_size: fields['Installed Size'] ?? '',
    depends,
  }
}

export const syncPacman = async (): Promise<{ ok: boolean; error?: string }> => {
  try {
    const proc = spawn(['pacman', '-Sy', '--noconfirm'], {
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...env, SYSTEMD_COLORS: '0', LC_ALL: 'C' },
    })
    const code = await proc.exited
    if (code === 0) return { ok: true }
    const err = proc.stderr ? await new Response(proc.stderr).text() : ''
    return { ok: false, error: err.trim() || `exit ${code}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
