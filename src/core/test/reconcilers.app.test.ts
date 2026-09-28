import { expect } from 'bun:test'
import path from 'path'
import type { Host } from '@bicycle/core/host'
import { Ports } from '@bicycle/core/ports'
import { App } from '@bicycle/core/reconcilers/app'
import { Testing } from '@bicycle/core/testing'

type EnvCase = {
  name: string
  env?: Record<string, string>
  vars?: unknown
  secrets?: Record<string, string>
  expect?: Record<string, string>
  throws?: true
}

const ENV_CASES: EnvCase[] = [
  { name: 'undefined input returns empty', expect: {} },
  { name: 'passes through literals', env: { A: '1', B: 'two' }, expect: { A: '1', B: 'two' } },
  {
    name: 'interpolates ${secret:...} tokens',
    secrets: { 'foo/bar': 'sekret' },
    env: { X: 'v=${secret:foo/bar}' },
    expect: { X: 'v=sekret' },
  },
  {
    name: 'missing secret propagates as error',
    env: { X: '${secret:nope}' },
    throws: true,
  },
  {
    name: 'interpolates vars (scalars and nested paths)',
    env: { PUID: '${admin.uid}', TZ: '${tz}' },
    vars: { admin: { uid: 1000 }, tz: 'UTC' },
    expect: { PUID: '1000', TZ: 'UTC' },
  },
  {
    name: 'mixes vars and secrets in one string',
    secrets: { 'api/key': 'k123' },
    env: { URL: 'https://${host}.lan/api?k=${secret:api/key}' },
    vars: { host: 'miniflux' },
    expect: { URL: 'https://miniflux.lan/api?k=k123' },
  },
]

Testing.each('App.resolveAppEnv', ENV_CASES, (c) =>
  Testing.within(async (w) => {
    for (const [addr, clear] of Object.entries(c.secrets ?? {})) await Testing.secret(w, addr, clear)
    const run = App.resolveAppEnv(w.host, c.env, c.vars ?? {})
    if (c.throws) await expect(run).rejects.toThrow()
    else expect(await run).toEqual(c.expect!)
  }),
)

type ArgsCase = {
  name: string
  base: string
  generated: string | null
  user: string | null
  expect: string[]
}

const ARGS_CASES: ArgsCase[] = [
  {
    name: 'base only when no overrides',
    base: '/s/compose.yml',
    generated: null,
    user: null,
    expect: ['-f', '/s/compose.yml'],
  },
  {
    name: 'generated then user override',
    base: '/s/c.yml',
    generated: '/s/g.yml',
    user: '/e/u.yml',
    expect: ['-f', '/s/c.yml', '-f', '/s/g.yml', '-f', '/e/u.yml'],
  },
  {
    name: 'only generated, no user',
    base: '/s/c.yml',
    generated: '/s/g.yml',
    user: null,
    expect: ['-f', '/s/c.yml', '-f', '/s/g.yml'],
  },
  {
    name: 'only user, no generated',
    base: '/s/c.yml',
    generated: null,
    user: '/e/u.yml',
    expect: ['-f', '/s/c.yml', '-f', '/e/u.yml'],
  },
]

Testing.each('App.buildComposeArgs', ARGS_CASES, (c) => {
  expect(App.buildComposeArgs(c.base, c.generated, c.user)).toEqual(c.expect)
})

const URL = 'git://C'
const REF = 'R'

type CatalogEntry = { compose: string; bicycle?: string }

const tree = (entries: Record<string, CatalogEntry>): Testing.Tree =>
  Object.fromEntries(
    Object.entries(entries).flatMap(([name, e]) => [
      [`${name}/compose.yml`, e.compose],
      ...(e.bicycle === undefined ? [] : [[`${name}/bicycle.yml`, e.bicycle]]),
    ]),
  )

const catalog = (entries: Record<string, CatalogEntry>): Testing.Action => ({
  do: 'repo',
  url: URL,
  ref: REF,
  tree: tree(entries),
})

type PlanCase = {
  name: string
  catalog: Record<string, CatalogEntry>
  app: string
  noAppConfig?: boolean
  env?: Record<string, string>
  userOverride?: string
  secrets?: Record<string, string>
  ports?: Record<string, number>
  plans?: number
  nullPlan?: boolean
  throws?: RegExp
  expect?: {
    env?: Record<string, string>
    mounts?: { hostRel: string; owner?: { uid: number; gid: number } }[]
    override?: { volumes?: Record<string, number>; ports?: Record<string, string[]> }
    http?: { service: string; hostPort: number; containerPort: number } | null
    ports?: Record<string, number>
  }
}

const PLAN_CASES: PlanCase[] = [
  {
    name: 'returns null when app config missing',
    catalog: {},
    app: 'ghost',
    noAppConfig: true,
    nullPlan: true,
  },
  {
    name: 'throws when catalog lacks <name>/compose.yml at ref',
    catalog: { other: { compose: 'services: {}\n' } },
    app: 'myapp',
    throws: /catalog has no myapp\/compose\.yml/,
  },
  {
    name: 'no manifest yields empty mounts and null overrideContent',
    catalog: { myapp: { compose: 'services:\n  myapp:\n    image: x\n' } },
    app: 'myapp',
    secrets: { 'myapp/pass': 'hunter2' },
    env: { PASS: '${secret:myapp/pass}', PLAIN: 'literal' },
    expect: { env: { PASS: 'hunter2', PLAIN: 'literal' }, mounts: [] },
  },
  {
    name: 'manifest populates mounts and overrideContent',
    catalog: {
      caddy: {
        compose: 'services:\n  caddy:\n    image: caddy\n',
        bicycle: `services:
  caddy:
    data:
      - path: /data
        owner: "0:0"
      - path: /config
`,
      },
    },
    app: 'caddy',
    expect: {
      mounts: [{ hostRel: 'apps/caddy/caddy/data', owner: { uid: 0, gid: 0 } }, { hostRel: 'apps/caddy/caddy/config' }],
      override: { volumes: { caddy: 2 } },
    },
  },
  {
    name: 'missing required env throws naming app and missing keys',
    catalog: {
      web: {
        compose: 'services:\n  web:\n    image: x\n',
        bicycle: 'env:\n  required: [TOKEN, BASE_URL]\n',
      },
    },
    app: 'web',
    env: { TOKEN: 't' },
    throws: /app "web" missing required env: BASE_URL/,
  },
  {
    name: 'required env present passes',
    catalog: {
      web: {
        compose: 'services:\n  web:\n    image: x\n',
        bicycle: 'env:\n  required: [TOKEN]\n',
      },
    },
    app: 'web',
    env: { TOKEN: 'abc' },
    expect: { env: { TOKEN: 'abc' } },
  },
  {
    name: 'detects user override file',
    catalog: { myapp: { compose: 'services:\n  myapp:\n    image: x\n' } },
    app: 'myapp',
    userOverride: 'services:\n  myapp:\n    environment: {}\n',
    expect: {},
  },
  {
    name: 'http.service absent from compose throws naming app and services',
    catalog: {
      web: {
        compose: 'services:\n  web:\n    image: x\n',
        bicycle: 'http:\n  service: nope\n  port: 80\n',
      },
    },
    app: 'web',
    throws: /app "web": http\.service "nope" is not a service in compose\.yml \(services: web\)/,
  },
  {
    name: 'http binds the first free loopback port and records it',
    catalog: {
      web: {
        compose: 'services:\n  web:\n    image: x\n',
        bicycle: 'http:\n  service: web\n  port: 80\n',
      },
    },
    app: 'web',
    expect: {
      http: { service: 'web', hostPort: 20000, containerPort: 80 },
      override: { ports: { web: ['127.0.0.1:20000:80'] } },
      ports: { web: 20000 },
    },
  },
  {
    name: 'planning the same app twice keeps its port',
    catalog: {
      web: {
        compose: 'services:\n  web:\n    image: x\n',
        bicycle: 'http:\n  service: web\n  port: 80\n',
      },
    },
    app: 'web',
    plans: 2,
    expect: {
      http: { service: 'web', hostPort: 20000, containerPort: 80 },
      override: { ports: { web: ['127.0.0.1:20000:80'] } },
      ports: { web: 20000 },
    },
  },
  {
    name: 'app without http releases the port the store held for it',
    catalog: { myapp: { compose: 'services:\n  myapp:\n    image: x\n' } },
    app: 'myapp',
    ports: { myapp: 20003, other: 20000 },
    expect: { http: null, ports: { other: 20000 } },
  },
]

Testing.each('App.plan', PLAN_CASES, (c) =>
  Testing.within(async (w) => {
    const { paths } = w.host
    const etc = paths.etc.app(c.app)
    await Testing.runActions(
      w,
      [
        catalog(c.catalog),
        ...(c.noAppConfig
          ? []
          : [
              {
                do: 'app' as const,
                name: c.app,
                config: { ref: REF, ...(c.env ? { env: c.env } : {}) },
                override: c.userOverride,
              },
            ]),
        ...Object.entries(c.secrets ?? {}).map(([addr, clear]) => ({ do: 'secret' as const, addr, clear })),
        ...(c.ports ? [{ do: 'ports' as const, store: c.ports }] : []),
      ],
      async () => {},
    )

    if (c.throws) {
      await expect(App.plan(w.host, c.app, URL, {})).rejects.toThrow(c.throws)
      return
    }
    const planned: (App.Plan | null)[] = []
    for (let i = 0; i < (c.plans ?? 1); i++) planned.push(await App.plan(w.host, c.app, URL, {}))
    const p = planned.at(-1)!
    if (c.nullPlan) {
      expect(p).toBeNull()
      return
    }

    expect(p).not.toBeNull()
    expect(p!.name).toBe(c.app)
    expect(p!.ref).toBe(REF)
    expect(p!.stateCompose).toBe(paths.state.app(c.app).compose)
    expect(p!.stateOverride).toBe(paths.state.app(c.app).override)
    expect(p!.userOverride).toBe(c.userOverride !== undefined ? etc.compose : null)

    if (c.expect?.env) expect(p!.env).toEqual(c.expect.env)
    if (c.expect?.mounts) {
      const actual = p!.mounts.map((m) => ({
        hostRel: path.relative(paths.state.root, m.hostPath),
        ...(m.owner ? { owner: m.owner } : {}),
      }))
      expect(actual).toEqual(c.expect.mounts)
    }
    if (c.expect?.override) {
      expect(p!.overrideContent).not.toBeNull()
      const parsed = Bun.YAML.parse(p!.overrideContent!) as any
      for (const [service, count] of Object.entries(c.expect.override.volumes ?? {})) {
        expect(parsed.services[service].volumes).toHaveLength(count)
      }
      for (const [service, list] of Object.entries(c.expect.override.ports ?? {})) {
        expect(parsed.services[service].ports).toEqual(list)
      }
    } else {
      expect(p!.overrideContent).toBeNull()
    }
    if (c.expect?.http !== undefined) expect(p!.http).toEqual(c.expect.http)
    if (c.expect?.ports) expect(Ports.read(w.host)).toEqual(c.expect.ports)
  }),
)

type MountCase = {
  name: string
  as?: Testing.Actor
  dirs?: string[]
  files?: string[]
  target: string
  owner?: Testing.Actor
  expect: { untouched?: string[]; owners: Record<string, Testing.Actor> }
}

const FOREIGN: Testing.Actor = { uid: 1, gid: 1 }

const MOUNT_CASES: MountCase[] = [
  {
    name: 'creates dir when absent',
    target: '/mnt/a',
    expect: { owners: { '/mnt/a': Testing.ROOT } },
  },
  {
    name: 'a mount that is already its owner is left alone',
    dirs: ['/mnt/b'],
    target: '/mnt/b',
    owner: Testing.ROOT,
    expect: { untouched: ['/mnt/b'], owners: { '/mnt/b': Testing.ROOT } },
  },
  {
    name: 'a new mount is given to its owner',
    target: '/mnt/c',
    owner: FOREIGN,
    expect: { owners: { '/mnt/c': FOREIGN } },
  },
  {
    name: 'a chown that is not permitted is tolerated',
    as: Testing.USER,
    dirs: ['/mnt/c'],
    target: '/mnt/c',
    owner: FOREIGN,
    expect: { owners: { '/mnt/c': Testing.USER } },
  },
  {
    name: 'everything under a mount that is already its owner is left alone',
    dirs: ['/mnt/rec/sub'],
    files: ['/mnt/rec/sub/f.txt'],
    target: '/mnt/rec',
    owner: Testing.ROOT,
    expect: {
      untouched: ['/mnt/rec', '/mnt/rec/sub', '/mnt/rec/sub/f.txt'],
      owners: { '/mnt/rec/sub/f.txt': Testing.ROOT },
    },
  },
  {
    name: 'everything under a mount is given to its owner',
    dirs: ['/mnt/rec/sub'],
    files: ['/mnt/rec/sub/f.txt'],
    target: '/mnt/rec',
    owner: FOREIGN,
    expect: { owners: { '/mnt/rec': FOREIGN, '/mnt/rec/sub': FOREIGN, '/mnt/rec/sub/f.txt': FOREIGN } },
  },
  {
    name: 'recursing with an owner that is not permitted changes nothing',
    as: Testing.USER,
    dirs: ['/mnt/rec/sub'],
    files: ['/mnt/rec/sub/f.txt'],
    target: '/mnt/rec',
    owner: FOREIGN,
    expect: { owners: { '/mnt/rec': Testing.USER, '/mnt/rec/sub': Testing.USER, '/mnt/rec/sub/f.txt': Testing.USER } },
  },
]

Testing.each('App.ensureMount', MOUNT_CASES, (c) =>
  Testing.within(
    (w) => {
      for (const dir of c.dirs ?? []) Testing.dir(w, dir)
      for (const file of c.files ?? []) Testing.put(w, file, 'T')
      for (const file of c.expect.untouched ?? []) Testing.node(w, file)!.stamp = 0

      App.ensureMount(w.host, { service: 'x', hostPath: c.target, containerPath: '/x', owner: c.owner })

      expect(Testing.node(w, c.target)?.kind).toBe('dir')
      for (const file of c.expect.untouched ?? []) expect(Testing.node(w, file)!.stamp).toBe(0)
      for (const [file, owner] of Object.entries(c.expect.owners)) expect(Testing.node(w, file)).toMatchObject(owner)
    },
    { as: c.as },
  ),
)

type SweepCase = Testing.ReconcilerCase & { sweep: Testing.Sweep; projects?: Record<string, Testing.Project> }

const WEB = {
  compose: 'services:\n  web:\n    image: x\n',
  bicycle: 'services:\n  web:\n    data:\n      - path: /data\n        owner: "1:1"\nhttp:\n  service: web\n  port: 80\n',
}
const CATALOG = { catalog: { url: URL } }
const NETWORK = 'docker network create bicycle'
const STATE = '/var/lib/bicycle/apps/web'
const UP = `docker compose -f ${STATE}/compose.yml -f ${STATE}/override.yml --project-directory /etc/bicycle/apps/web -p web up -d`

const APPLY_CASES: SweepCase[] = [
  {
    name: 'all brings a declared app up from what it wrote',
    sweep: App.all,
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: WEB }),
      { do: 'secret', addr: 'web/token', clear: 'T' },
      { do: 'app', name: 'web', config: { ref: REF, env: { TOKEN: '${secret:web/token}' } } },
      { do: 'sweep' },
    ],
    state: [
      { path: 'apps/web/compose.yml', contents: WEB.compose },
      { path: 'apps/web/override.yml' },
      { path: 'apps/web/web/data', dir: true, owner: FOREIGN },
    ],
    ports: { web: 20000 },
    changes: [NETWORK, UP],
    projects: {
      web: {
        files: [`${STATE}/compose.yml`, `${STATE}/override.yml`],
        dir: '/etc/bicycle/apps/web',
        env: { TOKEN: 'T' },
      },
    },
  },
  {
    name: "the app's own override comes last",
    sweep: App.all,
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: WEB }),
      { do: 'app', name: 'web', config: { ref: REF }, override: 'services: {}\n' },
      { do: 'sweep' },
    ],
    changes: [
      NETWORK,
      `docker compose -f ${STATE}/compose.yml -f ${STATE}/override.yml -f /etc/bicycle/apps/web/compose.yml --project-directory /etc/bicycle/apps/web -p web up -d`,
    ],
  },
  {
    name: 'an app with nothing to generate has its old override removed',
    sweep: App.all,
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: { compose: WEB.compose } }),
      { do: 'state', rel: 'apps/web/override.yml', contents: 'services: {}\n' },
      { do: 'ports', store: { web: 20000 } },
      { do: 'app', name: 'web', config: { ref: REF } },
      { do: 'sweep' },
    ],
    state: [{ path: 'apps/web/override.yml', absent: true }],
    ports: {},
    changes: [NETWORK, `docker compose -f ${STATE}/compose.yml --project-directory /etc/bicycle/apps/web -p web up -d`],
  },
  {
    name: 'a second pass keeps the network and the port',
    sweep: App.all,
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: WEB }),
      { do: 'app', name: 'web', config: { ref: REF } },
      { do: 'sweep' },
      { do: 'sweep' },
    ],
    ports: { web: 20000 },
    changes: [NETWORK, UP, UP],
  },
  {
    name: 'one brings up the app it is asked for and no other',
    sweep: (host: Host) => App.one(host, 'web'),
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: WEB, other: WEB }),
      { do: 'app', name: 'web', config: { ref: REF } },
      { do: 'app', name: 'other', config: { ref: REF } },
      { do: 'sweep' },
    ],
    changes: [NETWORK, UP],
  },
]

const REJECT_CASES: SweepCase[] = [
  {
    name: 'an app that does not come up has failed',
    sweep: App.all,
    actions: [
      { do: 'fault', program: 'docker', args: ['compose', 'up'], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: CATALOG },
      catalog({ web: WEB }),
      { do: 'app', name: 'web', config: { ref: REF } },
      { do: 'sweep' },
    ],
    rejects: /docker compose up failed \(exit 1\): E/,
    changes: [NETWORK],
    ports: { web: 20000 },
    errors: ['app: reconcile failed'],
  },
  {
    name: 'a ref the catalog does not have has failed',
    sweep: App.all,
    actions: [
      { do: 'config', config: CATALOG },
      catalog({ web: WEB }),
      { do: 'app', name: 'web', config: { ref: 'Z' } },
      { do: 'sweep' },
    ],
    rejects: /git fetch Z from git:\/\/C failed \(exit 128\)/,
  },
  {
    name: 'a machine with no catalog cannot have apps',
    sweep: App.all,
    actions: [{ do: 'config', config: {} }, { do: 'app', name: 'web', config: { ref: REF } }, { do: 'sweep' }],
    rejects: /missing `catalog.url`/,
  },
]

const DOWN = 'docker compose -p old down'

const REMOVAL_CASES: SweepCase[] = [
  {
    name: 'all removes a deployed app that is no longer declared',
    sweep: App.all,
    actions: [
      { do: 'state', rel: 'apps/old/compose.yml', contents: 'services: {}\n' },
      { do: 'state', rel: 'apps/old/override.yml', contents: 'services: {}\n' },
      { do: 'state', rel: 'apps/old/svc/data/keep.txt', contents: 'keep\n' },
      { do: 'ports', store: { old: 20000, other: 20001 } },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [DOWN],
    state: [
      { path: 'apps/old/compose.yml', absent: true },
      { path: 'apps/old/override.yml', absent: true },
      { path: 'apps/old/svc/data/keep.txt', contents: 'keep\n' },
    ],
    ports: { other: 20001 },
  },
  {
    name: 'all removes a deployed app that has no override',
    sweep: App.all,
    actions: [
      { do: 'state', rel: 'apps/old/compose.yml', contents: 'services: {}\n' },
      { do: 'state', rel: 'apps/old/svc/data/keep.txt', contents: 'keep\n' },
      { do: 'ports', store: { old: 20000, other: 20001 } },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [DOWN],
    state: [
      { path: 'apps/old/compose.yml', absent: true },
      { path: 'apps/old/svc/data/keep.txt', contents: 'keep\n' },
    ],
    ports: { other: 20001 },
  },
  {
    name: 'all without a bicycle.yml leaves deployed apps alone',
    sweep: App.all,
    actions: [
      { do: 'state', rel: 'apps/old/compose.yml', contents: 'services: {}\n' },
      { do: 'ports', store: { old: 20000 } },
      { do: 'sweep' },
    ],
    changes: [],
    state: [{ path: 'apps/old/compose.yml', contents: 'services: {}\n' }],
    ports: { old: 20000 },
  },
  {
    name: 'all leaves a state dir without a compose alone',
    sweep: App.all,
    actions: [
      { do: 'state', rel: 'apps/gone/svc/data/keep.txt', contents: 'keep\n' },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [],
    state: [{ path: 'apps/gone/svc/data/keep.txt', contents: 'keep\n' }],
  },
  {
    name: 'an app that does not come down keeps its state and its port',
    sweep: App.all,
    actions: [
      { do: 'fault', program: 'docker', args: ['compose', 'down'], reply: { code: 1, stderr: 'E' } },
      { do: 'state', rel: 'apps/old/compose.yml', contents: 'services: {}\n' },
      { do: 'ports', store: { old: 20000 } },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    rejects: /docker compose down failed \(exit 1\): E/,
    changes: [],
    state: [{ path: 'apps/old/compose.yml', contents: 'services: {}\n' }],
    ports: { old: 20000 },
  },
  {
    name: 'one removes a deployed app whose etc config is gone',
    sweep: (host: Host) => App.one(host, 'old'),
    actions: [
      { do: 'state', rel: 'apps/old/compose.yml', contents: 'services: {}\n' },
      { do: 'ports', store: { old: 20000 } },
      { do: 'sweep' },
    ],
    changes: [DOWN],
    state: [{ path: 'apps/old/compose.yml', absent: true }],
    ports: {},
  },
  {
    name: 'one with neither etc config nor state compose is a no-op',
    sweep: (host: Host) => App.one(host, 'ghost'),
    actions: [{ do: 'sweep' }],
    changes: [],
  },
]

const unplanned = { plan: async () => [] }

Testing.each('App', [...APPLY_CASES, ...REJECT_CASES, ...REMOVAL_CASES], (c) =>
  Testing.within(async (w) => {
    await Testing.runReconcilerCase(w, unplanned, c.sweep, c)
    if (c.projects) expect(w.machine.projects).toEqual(c.projects)
  }),
)
