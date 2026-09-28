import type { BicycleConfig } from '@bicycle/shared'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'
import { Interpolate } from '@bicycle/core/interpolate'
import { Ports } from '@bicycle/core/ports'
import { Git } from '@bicycle/core/reconcilers/git'
import { Manifest } from '@bicycle/core/reconcilers/manifest'
import { Network } from '@bicycle/core/reconcilers/network'
import { Secrets } from '@bicycle/core/secrets'
import { Tree } from '@bicycle/core/tree'

export namespace App {
  export type Plan = {
    name: string
    ref: string
    baseCompose: string
    stateRoot: string
    stateCompose: string
    stateOverride: string
    overrideContent: string | null
    mounts: Manifest.Mount[]
    http: Manifest.HttpBinding | null
    userOverride: string | null
    projectDir: string
    env: Record<string, string>
  }

  export async function resolveAppEnv(
    host: Host,
    declared: Record<string, string> | undefined,
    vars: unknown,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(declared ?? {})) {
      out[k] = await Interpolate.run(v, vars, (addr) => Secrets.read(host, addr))
    }
    return out
  }

  export const buildComposeArgs = (base: string, generated: string | null, user: string | null): string[] => [
    '-f',
    base,
    ...(generated === null ? [] : ['-f', generated]),
    ...(user === null ? [] : ['-f', user]),
  ]

  export function ensureMount(host: Host, m: Manifest.Mount): void {
    host.disk.mkdir(m.hostPath)
    if (!m.owner) return
    Disk.own(host.disk, m.hostPath, m.owner.uid, m.owner.gid)
  }

  export async function plan(host: Host, name: string, catalog: string, vars: unknown): Promise<Plan | null> {
    const { paths, disk } = host
    const etc = paths.etc.app(name)
    if (!Disk.exists(disk, etc.config)) return null

    const cfg = Tree.app(host, name)
    const cache = paths.state.catalog(name, cfg.ref)

    host.log.info({ app: name, ref: cfg.ref, catalog }, 'app: fetching catalog')
    await Git.ensure(host, { repo: catalog, ref: cfg.ref, dest: cache.root, sparse: [name] })

    if (!Disk.exists(disk, cache.compose)) {
      throw new Error(`catalog has no ${name}/compose.yml at ref ${cfg.ref}`)
    }

    const m = Manifest.load(disk, cache.manifest)
    const env = await resolveAppEnv(host, cfg.env, vars)
    Manifest.validateEnv(m.env, env, name)

    const store = Ports.read(host)
    const http = m.http ? bind(host, store, name, m.http, cache.compose) : null
    if (http === null) Ports.release(store, name)
    Ports.write(host, store)

    const mounts = Manifest.planMounts(paths, m, name)
    const state = paths.state.app(name)

    return {
      name,
      ref: cfg.ref,
      baseCompose: cache.compose,
      stateRoot: state.root,
      stateCompose: state.compose,
      stateOverride: state.override,
      overrideContent: Manifest.generateOverride(mounts, http),
      mounts,
      http,
      userOverride: Disk.exists(disk, etc.compose) ? etc.compose : null,
      projectDir: etc.root,
      env,
    }
  }

  function bind(
    host: Host,
    store: Ports.Store,
    name: string,
    http: Manifest.HttpSpec,
    file: string,
  ): Manifest.HttpBinding {
    const compose = Bun.YAML.parse(Disk.text(host.disk, file)) as {
      services?: Manifest.ComposeServices
    }
    Manifest.validateHttp(http, compose.services ?? {}, name)
    return {
      service: http.service,
      hostPort: Ports.allocate(store, name),
      containerPort: http.port,
    }
  }

  export async function execute(host: Host, p: Plan): Promise<void> {
    host.disk.mkdir(p.stateRoot)
    host.disk.copy(p.baseCompose, p.stateCompose)

    if (p.overrideContent !== null) host.disk.write(p.stateOverride, p.overrideContent)
    else host.disk.remove(p.stateOverride)

    for (const m of p.mounts) ensureMount(host, m)

    const generated = p.overrideContent !== null ? p.stateOverride : null
    const files = buildComposeArgs(p.stateCompose, generated, p.userOverride)

    host.log.info({ app: p.name, ref: p.ref, mounts: p.mounts.length }, 'app: docker compose up')
    const up = await host.exec(
      ['docker', 'compose', ...files, '--project-directory', p.projectDir, '-p', p.name, 'up', '-d'],
      { env: p.env },
    )
    if (up.code !== 0) throw new Error(`docker compose up failed (exit ${up.code}): ${up.stderr.trim()}`)

    host.log.info({ app: p.name, ref: p.ref }, 'app: reconciled')
  }

  function catalog(cfg: BicycleConfig): { url: string; vars: unknown } {
    if (!cfg.catalog) throw new Error('bicycle.yml: missing `catalog.url`')
    return { url: cfg.catalog.url, vars: cfg.vars ?? {} }
  }

  async function remove(host: Host, name: string): Promise<void> {
    const state = host.paths.state.app(name)
    host.log.info({ app: name }, 'app: removing')
    const down = await host.exec(['docker', 'compose', '-p', name, 'down'])
    if (down.code !== 0) throw new Error(`docker compose down failed (exit ${down.code}): ${down.stderr.trim()}`)
    const store = Ports.read(host)
    Ports.release(store, name)
    Ports.write(host, store)
    host.disk.remove(state.compose)
    host.disk.remove(state.override)
    host.log.info({ app: name }, 'app: removed')
  }

  async function apply(host: Host, name: string, cfg: BicycleConfig): Promise<void> {
    try {
      const { url, vars } = catalog(cfg)
      await Network.ensure(host)
      const p = await plan(host, name, url, vars)
      if (p) await execute(host, p)
    } catch (e) {
      host.log.error({ err: e, app: name }, 'app: reconcile failed')
      throw e
    }
  }

  export async function one(host: Host, name: string): Promise<void> {
    const { paths, disk } = host
    if (Disk.exists(disk, paths.etc.app(name).config)) return apply(host, name, Tree.bicycle(host))
    if (Disk.exists(disk, paths.state.app(name).compose)) await remove(host, name)
  }

  const listed = (host: Host, dir: string): string[] =>
    Disk.exists(host.disk, dir)
      ? host.disk
          .list(dir)
          .map((ent) => ent.name)
          .sort()
      : []

  export const names = (host: Host): string[] =>
    listed(host, host.paths.etc.apps).filter((name) => {
      const app = host.paths.etc.app(name)
      return host.disk.stat(app.root)?.kind === 'dir' && Disk.exists(host.disk, app.config)
    })

  export async function all(host: Host): Promise<void> {
    const { paths } = host
    const cfg = Tree.maybe(host)
    if (!cfg) return
    const declared = names(host)
    for (const name of declared) await apply(host, name, cfg)

    const orphans = listed(host, paths.state.apps).filter(
      (name) => !declared.includes(name) && Disk.exists(host.disk, paths.state.app(name).compose),
    )

    for (const name of orphans) {
      try {
        await remove(host, name)
      } catch (e) {
        host.log.error({ err: e, app: name }, 'app: remove failed')
        throw e
      }
    }
  }
}
