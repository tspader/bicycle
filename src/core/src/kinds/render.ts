import type { Diff, DiffValue } from '@bicycle/shared'

export namespace Render {
  const SHA256_HEX = /^[0-9a-f]{64}$/

  export function ago(iso: string, now: Date): string {
    const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000))
    if (mins < 60) return `${mins}m ago`
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
    return `${Math.round(mins / (60 * 24))}d ago`
  }

  export function value(v: DiffValue): string {
    if (v === null) return '<none>'
    if (Array.isArray(v)) return v.join(',')
    if (typeof v === 'string' && SHA256_HEX.test(v)) return `sha256:${v.slice(0, 12)}`
    return String(v)
  }

  export function line(d: Diff): string {
    const red = d.redacted ? ' (redacted)' : ''
    if (d.expected === null) return `+ ${d.type} ${d.id} ${d.field}: ${value(d.actual)}${red}`
    if (d.actual === null) return `- ${d.type} ${d.id} ${d.field}: ${value(d.expected)}${red}`
    return `~ ${d.type} ${d.id} ${d.field}: ${value(d.actual)} -> ${value(d.expected)}${red}`
  }
}
