import { vars as Vars } from '@bicycle/shared'

export namespace Interpolate {
  export type Secret = (addr: string) => Promise<string>

  const REF = /\$\{([^}]+)\}/g
  const VAR_PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
  const SECRET_PREFIX = 'secret:'

  async function resolve(inner: string, vars: unknown, secret: Secret): Promise<string> {
    if (inner.startsWith(SECRET_PREFIX)) return secret(inner.slice(SECRET_PREFIX.length))
    if (!VAR_PATH.test(inner)) throw new Error(`invalid interpolation \${${inner}}`)
    const val = Vars.get(vars, inner)
    if (val === undefined) throw new Error(`unresolved \${${inner}}`)
    if (typeof val === 'object' && val !== null) {
      throw new Error(`cannot substitute object value \${${inner}}`)
    }
    return String(val)
  }

  export async function run(text: string, vars: unknown, secret: Secret): Promise<string> {
    const matches = [...text.matchAll(REF)]
    const values = await Promise.all(matches.map((m) => resolve(m[1]!, vars, secret)))
    const pieces = matches.map((m, i) => {
      const from = i === 0 ? 0 : matches[i - 1]!.index + matches[i - 1]![0].length
      return text.slice(from, m.index) + values[i]!
    })
    const last = matches.at(-1)
    return pieces.join('') + text.slice(last === undefined ? 0 : last.index + last[0].length)
  }
}
