import path from 'path'

export interface Paths {
  key: string
  scanner: string
  host: (rel: string) => string
  etc: {
    root: string
    bicycle: string
    ignore: string
    recipients: string
    files: string
    secrets: string
    apps: string
    app: (name: string) => { root: string; config: string; compose: string }
  }
  run: {
    root: string
    prunes: string
    claims: string
  }
  state: {
    root: string
    written: string
    ports: string
    ingress: { root: string; compose: string; caddy: string; caddyfile: string; data: string; config: string }
    scans: string
    scan: (detector: string) => string
    detector: (detector: string) => string
    catalog: (app: string, ref: string) => { root: string; compose: string; manifest: string }
    logs: string
    apps: string
    app: (name: string) => {
      root: string
      compose: string
      override: string
      mount: (service: string, base: string) => string
    }
  }
}

export namespace Paths {
  export type Roots = { etc: string; state: string; run: string; root: string; key: string; scanner: string }

  export const of = (roots: Roots): Paths => ({
    key: roots.key,
    scanner: roots.scanner,
    host: (rel) => path.join(roots.root, rel),
    etc: {
      root: roots.etc,
      bicycle: path.join(roots.etc, 'bicycle.yml'),
      ignore: path.join(roots.etc, 'ignore.yml'),
      recipients: path.join(roots.etc, 'recipients'),
      files: path.join(roots.etc, 'files'),
      secrets: path.join(roots.etc, 'secrets'),
      apps: path.join(roots.etc, 'apps'),
      app: (name) => ({
        root: path.join(roots.etc, 'apps', name),
        config: path.join(roots.etc, 'apps', name, 'config.yml'),
        compose: path.join(roots.etc, 'apps', name, 'compose.yml'),
      }),
    },
    run: {
      root: roots.run,
      prunes: path.join(roots.run, 'scan-prunes.txt'),
      claims: path.join(roots.run, 'claims.txt'),
    },
    state: {
      root: roots.state,
      written: path.join(roots.state, 'files-manifest.json'),
      ports: path.join(roots.state, 'ports.json'),
      ingress: {
        root: path.join(roots.state, 'ingress'),
        compose: path.join(roots.state, 'ingress', 'compose.yml'),
        caddy: path.join(roots.state, 'ingress', 'caddy'),
        caddyfile: path.join(roots.state, 'ingress', 'caddy', 'Caddyfile'),
        data: path.join(roots.state, 'ingress', 'data'),
        config: path.join(roots.state, 'ingress', 'config'),
      },
      scans: path.join(roots.state, 'scan'),
      scan: (detector) => path.join(roots.state, 'scan', `${detector}.json`),
      detector: (detector) => path.join(roots.state, 'cache', 'detect', detector),
      catalog: (app, ref) => {
        const root = path.join(roots.state, 'cache', 'catalog', app, ref)
        return {
          root,
          compose: path.join(root, app, 'compose.yml'),
          manifest: path.join(root, app, 'bicycle.yml'),
        }
      },
      logs: path.join(roots.state, 'logs'),
      apps: path.join(roots.state, 'apps'),
      app: (name) => ({
        root: path.join(roots.state, 'apps', name),
        compose: path.join(roots.state, 'apps', name, 'compose.yml'),
        override: path.join(roots.state, 'apps', name, 'override.yml'),
        mount: (service, base) => path.join(roots.state, 'apps', name, service, base),
      }),
    },
  })
}
