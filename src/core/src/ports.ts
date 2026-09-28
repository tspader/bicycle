import path from 'path'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'

export namespace Ports {
  export type Store = Record<string, number>

  export const RANGE = { first: 20000, last: 20999 }

  export const read = (host: Host): Store =>
    Disk.exists(host.disk, host.paths.state.ports) ? JSON.parse(Disk.text(host.disk, host.paths.state.ports)) : {}

  export function write(host: Host, store: Store): void {
    host.disk.mkdir(path.dirname(host.paths.state.ports))
    const sorted = Object.fromEntries(
      Object.keys(store)
        .sort()
        .map((k) => [k, store[k]]),
    )
    Disk.replace(host.disk, host.paths.state.ports, JSON.stringify(sorted, null, 2) + '\n')
  }

  export function allocate(store: Store, name: string): number {
    if (name in store) return store[name]!
    const used = new Set(Object.values(store))
    for (let port = RANGE.first; port <= RANGE.last; port++) {
      if (used.has(port)) continue
      store[name] = port
      return port
    }
    throw new Error(`ports: range ${RANGE.first}-${RANGE.last} exhausted`)
  }

  export const release = (store: Store, name: string): void => {
    delete store[name]
  }
}
