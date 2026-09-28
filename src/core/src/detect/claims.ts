import path from 'path'
import type { Host } from '@bicycle/core/host'

export interface Claims {
  exact: string[]
  prefixes: string[]
}

export namespace Claims {
  export const render = (c: Claims): string =>
    [...c.prefixes.map((p) => `P ${p}`), ...c.exact.map((p) => `E ${p}`), ''].join('\n')

  export function write(host: Host, c: Claims): string {
    host.disk.mkdir(path.dirname(host.paths.run.claims))
    host.disk.write(host.paths.run.claims, render(c))
    return host.paths.run.claims
  }
}
