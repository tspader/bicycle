import { Liquid } from 'liquidjs'

export namespace Template {
  export type Rendered = { text: string; secret: boolean }

  function rgb(v: unknown): [number, number, number] {
    const h = String(v).replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex color: ${String(v)}`)
    const at = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [at(0), at(2), at(4)]
  }

  export async function render(
    source: string,
    vars: unknown,
    secret: (addr: string) => Promise<string>,
  ): Promise<Rendered> {
    const engine = new Liquid({ strictVariables: true, strictFilters: true })
    const used = { secret: false }
    engine.registerFilter('secret', (addr: unknown) => {
      used.secret = true
      return secret(String(addr))
    })
    engine.registerFilter('strip', (v: unknown) => String(v).replace(/^#/, ''))
    engine.registerFilter('rgb', (v: unknown) => rgb(v).join(' '))
    engine.registerFilter('rgb_comma', (v: unknown) => rgb(v).join(','))
    const text = await engine.parseAndRender(source, (vars as object) ?? {})
    return { text, secret: used.secret }
  }
}
