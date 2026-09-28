import crypto from 'crypto'
import path from 'path'
import type { AppConfig, Diff, Ingress as Declared } from '@bicycle/shared'
import type { Claims } from '@bicycle/core/detect/claims'
import { Disk, Fail } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Ports } from '@bicycle/core/ports'
import { App } from '@bicycle/core/reconcilers/app'
import { Hosts } from '@bicycle/core/reconcilers/hosts'
import { Tree } from '@bicycle/core/tree'

export namespace Ingress {
  export type Route = { name: string; port: number }
  export type Exposed = { name: string; config: AppConfig; port: number }

  export function routes(ingress: Declared, apps: Exposed[]): Route[] {
    const labeled = [
      ...Object.entries(ingress.routes ?? {}).map(([name, port]) => ({
        name,
        port,
        source: 'ingress.routes',
      })),
      ...apps
        .filter((a) => a.config.expose !== false)
        .map((a) => ({ name: a.config.host ?? a.name, port: a.port, source: `app "${a.name}"` })),
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (let i = 1; i < labeled.length; i++) {
      const prev = labeled[i - 1]!
      const cur = labeled[i]!
      if (prev.name === cur.name) {
        throw new Error(`ingress: route "${cur.name}" declared by both ${prev.source} and ${cur.source}`)
      }
    }
    return labeled.map(({ name, port }) => ({ name, port }))
  }

  export const render = (domain: string, routes: Route[]): string =>
    routes.map((r) => `http://${r.name}.${domain} {\n\treverse_proxy 127.0.0.1:${r.port}\n}\n`).join('\n')

  const HOSTS = 'etc/hosts'
  const CONTAINER = 'bicycle-ingress'
  const PROJECT = 'bicycle-ingress'
  const IMAGE = 'caddy:2.10'
  const CADDY_DIR = '/etc/caddy'
  const CADDYFILE = `${CADDY_DIR}/Caddyfile`
  const STATUS_FORMAT = '{{.State.Status}}'

  type Observed = {
    routes: Route[]
    compose: { path: string; want: string; current: string | null }
    caddyfile: { path: string; want: string; current: string | null }
    hosts: { path: string; block: string; want: string; current: string }
    status: string | null
  }

  const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')

  const read = (host: Host, p: string): string | null => (Disk.exists(host.disk, p) ? Disk.text(host.disk, p) : null)

  export function current(host: Host, ingress: Declared): Route[] {
    const store = Ports.read(host)
    const apps = App.names(host).flatMap((name) => {
      const port = store[name]
      return port === undefined ? [] : [{ name, config: Tree.app(host, name), port }]
    })
    return routes(ingress, apps)
  }

  async function observe(host: Host, ingress: Declared): Promise<Observed> {
    const table = current(host, ingress)

    const state = host.paths.state.ingress
    const compose =
      JSON.stringify(
        {
          services: {
            caddy: {
              image: IMAGE,
              container_name: CONTAINER,
              network_mode: 'host',
              restart: 'unless-stopped',
              volumes: [`${state.caddy}:${CADDY_DIR}:ro`, `${state.data}:/data`, `${state.config}:/config`],
            },
          },
        },
        null,
        2,
      ) + '\n'

    const hostsPath = host.paths.host(HOSTS)
    const hostsCurrent = read(host, hostsPath) ?? ''
    const block = Hosts.block(table.map((r) => `${r.name}.${ingress.domain}`))

    const inspect = await host.exec(['docker', 'inspect', '--format', STATUS_FORMAT, CONTAINER])

    return {
      routes: table,
      compose: { path: state.compose, want: compose, current: read(host, state.compose) },
      caddyfile: {
        path: state.caddyfile,
        want: render(ingress.domain, table),
        current: read(host, state.caddyfile),
      },
      hosts: {
        path: hostsPath,
        block,
        want: Hosts.splice(hostsCurrent, block),
        current: hostsCurrent,
      },
      status: inspect.code === 0 ? inspect.stdout.trim() : null,
    }
  }

  export async function plan(host: Host): Promise<Diff[]> {
    const cfg = Tree.maybe(host)
    if (!cfg?.ingress) return []
    const o = await observe(host, cfg.ingress)
    const diffs: Diff[] = []
    if (o.compose.current !== o.compose.want) {
      diffs.push({
        type: 'ingress',
        id: 'compose.yml',
        field: 'content',
        expected: sha(o.compose.want),
        actual: o.compose.current === null ? null : sha(o.compose.current),
      })
    }
    if (o.caddyfile.current !== o.caddyfile.want) {
      diffs.push({
        type: 'ingress',
        id: 'Caddyfile',
        field: 'content',
        expected: sha(o.caddyfile.want),
        actual: o.caddyfile.current === null ? null : sha(o.caddyfile.current),
      })
    }
    if (o.status !== 'running') {
      diffs.push({ type: 'ingress', id: 'caddy', field: 'status', expected: 'running', actual: o.status })
    }
    if (o.hosts.current !== o.hosts.want) {
      diffs.push({
        type: 'file',
        id: HOSTS,
        field: 'content',
        expected: sha(o.hosts.want),
        actual: sha(o.hosts.current),
      })
    }
    return diffs
  }

  function hosts(host: Host, o: Observed): void {
    try {
      host.disk.mkdir(path.dirname(o.hosts.path))
      Disk.replace(host.disk, o.hosts.path, o.hosts.want)
      host.log.info({ dest: o.hosts.path, names: o.routes.length }, 'ingress: wrote hosts')
    } catch (e) {
      if (!(e instanceof Fail.Error) || e.kind !== 'denied') throw e
      host.log.warn({ dest: o.hosts.path, block: o.hosts.block }, 'ingress: hosts not writable; run the daemon as root')
    }
  }

  export async function all(host: Host): Promise<void> {
    const cfg = Tree.maybe(host)
    if (!cfg?.ingress) return
    const o = await observe(host, cfg.ingress)
    const state = host.paths.state.ingress
    host.disk.mkdir(state.root)
    host.disk.mkdir(state.caddy)
    host.disk.mkdir(state.data)
    host.disk.mkdir(state.config)

    if (o.compose.current !== o.compose.want) {
      Disk.replace(host.disk, o.compose.path, o.compose.want)
      host.log.info({ dest: o.compose.path }, 'ingress: wrote compose.yml')
    }

    const drifted = o.caddyfile.current !== o.caddyfile.want
    if (drifted) {
      Disk.replace(host.disk, o.caddyfile.path, o.caddyfile.want)
      host.log.info({ dest: o.caddyfile.path, routes: o.routes.length }, 'ingress: wrote Caddyfile')
    }

    const up = await host.exec(['docker', 'compose', '-f', o.compose.path, '-p', PROJECT, 'up', '-d'])
    if (up.code !== 0) {
      host.log.error({ exitCode: up.code, stderr: up.stderr.trim() }, 'ingress: docker compose up failed')
      return
    }

    if (drifted && o.status === 'running') {
      const reload = await host.exec(['docker', 'exec', CONTAINER, 'caddy', 'reload', '--config', CADDYFILE])
      if (reload.code !== 0) {
        host.log.error({ exitCode: reload.code, stderr: reload.stderr.trim() }, 'ingress: caddy reload failed')
      } else {
        host.log.info({ routes: o.routes.length }, 'ingress: caddy reloaded')
      }
    }

    if (o.hosts.current !== o.hosts.want) hosts(host, o)
  }

  export const claims = (): Claims => ({
    exact: [path.join('/', HOSTS)],
    prefixes: [],
  })
}
