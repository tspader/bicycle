import path from 'path'
import { Disk } from '@bicycle/core/disk'
import type { Paths } from '@bicycle/core/paths'

export namespace Manifest {
  export type DataEntry = {
    path: string
    owner?: string
  }

  export type ServiceManifest = {
    data?: DataEntry[]
  }

  export type EnvSpec = {
    required?: string[]
    optional?: string[]
  }

  export type HttpSpec = {
    service: string
    port: number
  }

  export type Manifest = {
    services?: Record<string, ServiceManifest>
    env?: EnvSpec
    http?: HttpSpec
  }

  export type Owner = { uid: number; gid: number }

  export type Mount = {
    service: string
    hostPath: string
    containerPath: string
    owner?: Owner
  }

  export type HttpBinding = {
    service: string
    hostPort: number
    containerPort: number
  }

  const TOP_KEYS = new Set(['services', 'env', 'http'])
  const SERVICE_KEYS = new Set(['data'])
  const DATA_KEYS = new Set(['path', 'owner'])
  const ENV_KEYS = new Set(['required', 'optional'])
  const HTTP_KEYS = new Set(['service', 'port'])

  function checkKeys(where: string, obj: object, allowed: Set<string>): void {
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k)) {
        throw new Error(`${where}: unknown key "${k}" (allowed: ${[...allowed].join(', ')})`)
      }
    }
  }

  export function load(disk: Disk, file: string): Manifest {
    if (!Disk.exists(disk, file)) return {}
    const parsed = Bun.YAML.parse(Disk.text(disk, file))
    if (parsed === null || parsed === undefined) return {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`manifest at ${file} must be a YAML mapping`)
    }

    checkKeys(file, parsed, TOP_KEYS)
    const m = parsed as Manifest

    if (m.env) checkKeys(`${file}: env`, m.env, ENV_KEYS)
    if (m.http) checkKeys(`${file}: http`, m.http, HTTP_KEYS)

    for (const [name, svc] of Object.entries(m.services ?? {})) {
      checkKeys(`${file}: services.${name}`, svc, SERVICE_KEYS)
      for (const [i, entry] of (svc.data ?? []).entries()) {
        checkKeys(`${file}: services.${name}.data[${i}]`, entry, DATA_KEYS)
      }
    }

    return m
  }

  export function parseOwner(s: string): Owner {
    const m = /^(\d+):(\d+)$/.exec(s.trim())
    if (!m) throw new Error(`invalid owner "${s}", expected "uid:gid"`)
    return { uid: parseInt(m[1]!, 10), gid: parseInt(m[2]!, 10) }
  }

  export function planMounts(paths: Paths, manifest: Manifest, name: string): Mount[] {
    const out: Mount[] = []
    const app = paths.state.app(name)
    for (const [service, svc] of Object.entries(manifest.services ?? {})) {
      for (const entry of svc.data ?? []) {
        if (!entry.path || !entry.path.startsWith('/')) {
          throw new Error(`service "${service}": data.path must be an absolute container path, got "${entry.path}"`)
        }
        const base = path.basename(entry.path)
        if (!base || base === '/' || base === '.') {
          throw new Error(`service "${service}": cannot derive host subdir from container path "${entry.path}"`)
        }
        out.push({
          service,
          hostPath: app.mount(service, base),
          containerPath: entry.path,
          owner: entry.owner ? parseOwner(entry.owner) : undefined,
        })
      }
    }
    return out
  }

  export function generateOverride(mounts: Mount[], http: HttpBinding | null): string | null {
    if (mounts.length === 0 && http === null) return null

    const services: Record<string, { volumes?: object[]; ports?: string[] }> = {}
    for (const m of mounts) {
      ;((services[m.service] ??= {}).volumes ??= []).push({
        type: 'bind',
        source: m.hostPath,
        target: m.containerPath,
      })
    }
    if (http !== null) {
      ;(services[http.service] ??= {}).ports = [`127.0.0.1:${http.hostPort}:${http.containerPort}`]
    }

    return JSON.stringify({ services }, null, 2) + '\n'
  }

  export function validateEnv(spec: EnvSpec | undefined, resolved: Record<string, string>, name: string): void {
    const missing = (spec?.required ?? []).filter((k) => !(k in resolved))
    if (missing.length > 0) throw new Error(`app "${name}" missing required env: ${missing.join(', ')}`)
  }

  export type ComposeService = { ports?: unknown }
  export type ComposeServices = Record<string, ComposeService | null | undefined>

  function portRange(spec: unknown): [number, number] | null {
    if (typeof spec === 'number') return [spec, spec]
    if (typeof spec !== 'string') return null
    const bounds = spec.split('/')[0]!.split('-').map(Number)
    const lo = bounds[0]
    const hi = bounds[1] ?? lo
    if (lo === undefined || hi === undefined) return null
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null
    return [lo, hi]
  }

  function publishedTarget(entry: unknown): [number, number] | null {
    if (typeof entry === 'number') return [entry, entry]
    if (typeof entry === 'string') return portRange(entry.split('/')[0]!.split(':').pop())
    if (entry && typeof entry === 'object' && 'target' in entry) return portRange(entry.target)
    return null
  }

  export function validateHttp(http: HttpSpec, services: ComposeServices, name: string): void {
    const names = Object.keys(services)
    if (!names.includes(http.service)) {
      throw new Error(
        `app "${name}": http.service "${http.service}" is not a service in compose.yml (services: ${names.join(', ')})`,
      )
    }
    const ports = services[http.service]?.ports
    if (!Array.isArray(ports)) return
    for (const entry of ports) {
      const range = publishedTarget(entry)
      if (!range || http.port < range[0] || http.port > range[1]) continue
      throw new Error(
        `app "${name}": service "${http.service}" publishes http.port ${http.port} in compose.yml ports (${JSON.stringify(entry)}); ingress owns that port, remove it`,
      )
    }
  }
}
