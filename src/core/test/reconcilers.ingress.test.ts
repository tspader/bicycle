import { expect } from 'bun:test'
import type { Ingress as Declared } from '@bicycle/shared'
import { Ingress } from '@bicycle/core/reconcilers/ingress'
import { Testing } from '@bicycle/core/testing'

type RoutesCase = {
  name: string
  ingress: Declared
  apps: Ingress.Exposed[]
  want?: Ingress.Route[]
  throws?: RegExp
}

const ROUTES_CASES: RoutesCase[] = [
  {
    name: 'only ingress.routes',
    ingress: { domain: 'aral.lan', routes: { grafana: 3000, dockge: 5001 } },
    apps: [],
    want: [
      { name: 'dockge', port: 5001 },
      { name: 'grafana', port: 3000 },
    ],
  },
  {
    name: 'only apps',
    ingress: { domain: 'aral.lan' },
    apps: [
      { name: 'miniflux', config: { ref: 'x' }, port: 20001 },
      { name: 'dockge', config: { ref: 'x' }, port: 20000 },
    ],
    want: [
      { name: 'dockge', port: 20000 },
      { name: 'miniflux', port: 20001 },
    ],
  },
  {
    name: 'app host overrides the label',
    ingress: { domain: 'aral.lan' },
    apps: [{ name: 'dockge', config: { ref: 'x', host: 'docks' }, port: 20000 }],
    want: [{ name: 'docks', port: 20000 }],
  },
  {
    name: 'app with expose false is dropped',
    ingress: { domain: 'aral.lan' },
    apps: [
      { name: 'dockge', config: { ref: 'x', expose: false }, port: 20000 },
      { name: 'miniflux', config: { ref: 'x' }, port: 20001 },
    ],
    want: [{ name: 'miniflux', port: 20001 }],
  },
  {
    name: 'ingress.routes and apps are merged and sorted',
    ingress: { domain: 'aral.lan', routes: { zzz: 9000, aaa: 9001 } },
    apps: [{ name: 'mmm', config: { ref: 'x' }, port: 20000 }],
    want: [
      { name: 'aaa', port: 9001 },
      { name: 'mmm', port: 20000 },
      { name: 'zzz', port: 9000 },
    ],
  },
  {
    name: 'duplicate between ingress.routes and an app throws',
    ingress: { domain: 'aral.lan', routes: { dockge: 5001 } },
    apps: [{ name: 'dockge', config: { ref: 'x' }, port: 20000 }],
    throws: /route "dockge" declared by both ingress\.routes and app "dockge"/,
  },
  {
    name: 'duplicate between two apps via host throws',
    ingress: { domain: 'aral.lan' },
    apps: [
      { name: 'a', config: { ref: 'x', host: 'shared' }, port: 20000 },
      { name: 'b', config: { ref: 'x', host: 'shared' }, port: 20001 },
    ],
    throws: /route "shared" declared by both app "a" and app "b"/,
  },
]

Testing.each('Ingress.routes', ROUTES_CASES, (c) => {
  if (c.throws) {
    expect(() => Ingress.routes(c.ingress, c.apps)).toThrow(c.throws)
    return
  }
  expect(Ingress.routes(c.ingress, c.apps)).toEqual(c.want!)
})

type RenderCase = {
  name: string
  routes: Ingress.Route[]
  want: string
}

const RENDER_CASES: RenderCase[] = [
  { name: 'zero routes is empty', routes: [], want: '' },
  {
    name: 'one route',
    routes: [{ name: 'dockge', port: 5001 }],
    want: 'http://dockge.aral.lan {\n\treverse_proxy 127.0.0.1:5001\n}\n',
  },
  {
    name: 'two routes separated by a blank line',
    routes: [
      { name: 'dockge', port: 5001 },
      { name: 'grafana', port: 3000 },
    ],
    want:
      'http://dockge.aral.lan {\n\treverse_proxy 127.0.0.1:5001\n}\n' +
      '\n' +
      'http://grafana.aral.lan {\n\treverse_proxy 127.0.0.1:3000\n}\n',
  },
]

Testing.each('Ingress.render', RENDER_CASES, (c) => {
  expect(Ingress.render('aral.lan', c.routes)).toBe(c.want)
})

const TWO_ROUTES = { ingress: { domain: 'aral.lan', routes: { dockge: 5001, grafana: 3000 } } }
const TWO_ROUTES_CADDYFILE =
  'http://dockge.aral.lan {\n\treverse_proxy 127.0.0.1:5001\n}\n' +
  '\n' +
  'http://grafana.aral.lan {\n\treverse_proxy 127.0.0.1:3000\n}\n'
const TWO_ROUTES_CADDYFILE_SHA = '2463c564dbd29b78b22226932d2ca0f748c2ca93aa25f5dc023a290dff21eded'
const TWO_ROUTES_HOSTS = '# bicycle\n127.0.0.1 dockge.aral.lan\n127.0.0.1 grafana.aral.lan\n# /bicycle\n'
const TWO_ROUTES_HOSTS_SHA = '43f65b19dcd8c19b79daa7a1f46989adc3f8030d6741d62447b9b9eb0ed0bd28'

const DOMAIN = { ingress: { domain: 'aral.lan' } }
const DOCKGE_CADDYFILE = 'http://dockge.aral.lan {\n\treverse_proxy 127.0.0.1:20000\n}\n'
const DOCKGE_HOSTS = '# bicycle\n127.0.0.1 dockge.aral.lan\n# /bicycle\n'

const UP = 'docker compose -f /var/lib/bicycle/ingress/compose.yml -p bicycle-ingress up -d'
const RELOAD = 'docker exec bicycle-ingress caddy reload --config /etc/caddy/Caddyfile'

const CASES: Testing.ReconcilerCase[] = [
  {
    name: 'no bicycle.yml: no-op',
    actions: [{ do: 'sweep' }],
    changes: [],
    plan: [],
  },
  {
    name: 'config without ingress: no-op',
    actions: [{ do: 'config', config: {} }, { do: 'sweep' }],
    changes: [],
    plan: [],
  },
  {
    name: 'plan: two routes with nothing on disk',
    actions: [{ do: 'config', config: TWO_ROUTES }],
    plan: [
      { type: 'ingress', id: 'compose.yml', field: 'content', actual: null },
      {
        type: 'ingress',
        id: 'Caddyfile',
        field: 'content',
        expected: TWO_ROUTES_CADDYFILE_SHA,
        actual: null,
      },
      { type: 'ingress', id: 'caddy', field: 'status', expected: 'running', actual: null },
      {
        type: 'file',
        id: 'etc/hosts',
        field: 'content',
        expected: TWO_ROUTES_HOSTS_SHA,
        actual: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    ],
  },
  {
    name: 'sweep: two routes writes state, hosts, and brings caddy up',
    actions: [{ do: 'config', config: TWO_ROUTES }, { do: 'sweep' }],
    state: [
      { path: 'ingress/caddy/Caddyfile', contents: TWO_ROUTES_CADDYFILE },
      { path: 'ingress/compose.yml' },
      { path: 'ingress/caddy', dir: true },
      { path: 'ingress/data', dir: true },
      { path: 'ingress/config', dir: true },
    ],
    fs: [{ path: 'etc/hosts', contents: TWO_ROUTES_HOSTS }],
    changes: [UP],
    plan: [],
  },
  {
    name: 'running container with a stale Caddyfile is reloaded',
    actions: [
      { do: 'system', system: { ingress: { status: 'running' } } },
      { do: 'state', rel: 'ingress/caddy/Caddyfile', contents: 'stale\n' },
      { do: 'config', config: TWO_ROUTES },
      { do: 'sweep' },
    ],
    state: [{ path: 'ingress/caddy/Caddyfile', contents: TWO_ROUTES_CADDYFILE }],
    changes: [UP, RELOAD],
    plan: [],
  },
  {
    name: 'running container with everything current is not reloaded',
    actions: [{ do: 'config', config: TWO_ROUTES }, { do: 'sweep' }, { do: 'sweep' }],
    changes: [UP, UP],
    plan: [],
  },
  {
    name: 'bound app gets a route and a hosts entry',
    actions: [
      { do: 'app', name: 'dockge', config: { ref: 'x' } },
      { do: 'ports', store: { dockge: 20000 } },
      { do: 'config', config: DOMAIN },
      { do: 'sweep' },
    ],
    state: [{ path: 'ingress/caddy/Caddyfile', contents: DOCKGE_CADDYFILE }],
    fs: [{ path: 'etc/hosts', contents: DOCKGE_HOSTS }],
    plan: [],
  },
  {
    name: 'app with expose false gets nothing',
    actions: [
      { do: 'app', name: 'dockge', config: { ref: 'x', expose: false } },
      { do: 'ports', store: { dockge: 20000 } },
      { do: 'config', config: DOMAIN },
      { do: 'sweep' },
    ],
    state: [{ path: 'ingress/caddy/Caddyfile', contents: '' }],
    fs: [{ path: 'etc/hosts', absent: true }],
    plan: [],
  },
  {
    name: 'app host relabels the route',
    actions: [
      { do: 'app', name: 'dockge', config: { ref: 'x', host: 'docks' } },
      { do: 'ports', store: { dockge: 20000 } },
      { do: 'config', config: DOMAIN },
      { do: 'sweep' },
    ],
    state: [
      {
        path: 'ingress/caddy/Caddyfile',
        contents: 'http://docks.aral.lan {\n\treverse_proxy 127.0.0.1:20000\n}\n',
      },
    ],
    fs: [{ path: 'etc/hosts', contents: '# bicycle\n127.0.0.1 docks.aral.lan\n# /bicycle\n' }],
    plan: [],
  },
  {
    name: 'app without a port store entry contributes nothing',
    actions: [{ do: 'app', name: 'dockge', config: { ref: 'x' } }, { do: 'config', config: DOMAIN }, { do: 'sweep' }],
    state: [{ path: 'ingress/caddy/Caddyfile', contents: '' }],
    fs: [{ path: 'etc/hosts', absent: true }],
    plan: [],
  },
  {
    name: 'existing hosts entries are preserved around the block',
    actions: [
      { do: 'host', rel: 'etc/hosts', contents: '127.0.0.1 localhost\n::1 localhost\n' },
      { do: 'config', config: TWO_ROUTES },
      { do: 'sweep' },
    ],
    fs: [{ path: 'etc/hosts', contents: '127.0.0.1 localhost\n::1 localhost\n' + TWO_ROUTES_HOSTS }],
    plan: [],
  },
  {
    name: 'duplicate label between ingress.routes and an app rejects',
    actions: [
      { do: 'app', name: 'dockge', config: { ref: 'x' } },
      { do: 'ports', store: { dockge: 20000 } },
      { do: 'config', config: { ingress: { domain: 'aral.lan', routes: { dockge: 5001 } } } },
      { do: 'sweep' },
    ],
    rejects: /declared by both/,
  },
  {
    name: 'a stopped container with a stale Caddyfile is started, not reloaded',
    actions: [
      { do: 'system', system: { ingress: { status: 'exited' } } },
      { do: 'state', rel: 'ingress/caddy/Caddyfile', contents: 'stale\n' },
      { do: 'config', config: TWO_ROUTES },
      { do: 'sweep' },
    ],
    changes: [UP],
    plan: [],
  },
  {
    name: 'a container that does not come up is logged and the hosts are left alone',
    actions: [
      { do: 'fault', program: 'docker', args: ['compose', 'up'], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: TWO_ROUTES },
      { do: 'sweep' },
    ],
    fs: [{ path: 'etc/hosts', absent: true }],
    changes: [],
    errors: ['ingress: docker compose up failed'],
  },
  {
    name: 'a reload that fails is logged and the hosts are still written',
    actions: [
      { do: 'system', system: { ingress: { status: 'running' } } },
      { do: 'fault', program: 'docker', args: ['exec'], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: TWO_ROUTES },
      { do: 'sweep' },
    ],
    fs: [{ path: 'etc/hosts', contents: TWO_ROUTES_HOSTS }],
    changes: [UP],
    errors: ['ingress: caddy reload failed'],
  },
  {
    name: 'unwritable hosts degrades to a warning',
    as: Testing.USER,
    actions: [{ do: 'hostDir', rel: 'etc', mode: 0o555 }, { do: 'config', config: TWO_ROUTES }, { do: 'sweep' }],
    fs: [{ path: 'etc/hosts', absent: true }],
    changes: [UP],
    warns: ['ingress: hosts not writable; run the daemon as root'],
    plan: [{ type: 'file', id: 'etc/hosts', field: 'content', expected: TWO_ROUTES_HOSTS_SHA }],
  },
]

Testing.reconciles('Ingress.all', Ingress, CASES)

type MountCase = { name: string; expect: string }

const MOUNT_CASES: MountCase[] = [
  {
    name: 'compose mounts the caddy directory so atomic Caddyfile writes reach the container',
    expect: '/var/lib/bicycle/ingress/caddy:/etc/caddy:ro',
  },
]

Testing.each('Ingress.all', MOUNT_CASES, (it) =>
  Testing.within(async (w) => {
    await Testing.runActions(w, [{ do: 'config', config: TWO_ROUTES }, { do: 'sweep' }], Ingress.all)
    const compose = JSON.parse(Testing.text(w, w.host.paths.state.ingress.compose)!)
    expect(compose.services.caddy.volumes).toContain(it.expect)
  }),
)
