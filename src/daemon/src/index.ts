import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Host } from '@bicycle/core/host'
import { Log } from '@bicycle/core/log'
import { Paths } from '@bicycle/core/paths'
import { Reconcilers } from '@bicycle/core/reconcilers'
import type { Config } from '@bicycle/daemon/config'
import { Jobs } from '@bicycle/daemon/jobs'
import { Logs } from '@bicycle/daemon/log'
import { Http } from '@bicycle/daemon/server'
import { Watch } from '@bicycle/daemon/watch'
import { Worker } from '@bicycle/daemon/worker'

export namespace Daemon {
  export const TICK = 250

  const host = (config: Config, vars: Host.Vars): Host => {
    const paths = Paths.of(config)
    return Host.real(paths, Log.to(Logs.sink(paths.state.logs, config.level)), vars)
  }

  export async function once(config: Config, vars: Host.Vars, only: Reconcilers.Name[]): Promise<void> {
    await Worker.once(host(config, vars), only)
  }

  export function run(config: Config, vars: Host.Vars): void {
    const machine = host(config, vars)
    const { paths, log } = machine
    const queue = Jobs.create(machine.clock.now, () => crypto.randomBytes(4).toString('hex'))
    const worker = Worker.real(machine, (message) => Jobs.push(queue, message))

    fs.mkdirSync(paths.etc.root, { recursive: true })
    const watcher = fs.watch(paths.etc.root, { recursive: true }, (_, name) => {
      if (name === null) return
      const work = Watch.classify(paths, path.join(paths.etc.root, name))
      if (work !== null) Jobs.submit(queue, work, 'watch', Watch.QUIET)
    })
    watcher.on('error', (err) => log.error({ err }, 'daemon: watcher error'))

    Jobs.submit(queue, { kind: 'reconcile', only: [...Reconcilers.ORDER] }, 'boot', 0)
    setInterval(() => Jobs.tick(queue, worker), TICK)

    const api = Bun.serve({
      hostname: config.host,
      port: config.port,
      idleTimeout: 0,
      fetch: Http.api(machine, queue).fetch,
    })
    const web = Bun.serve({
      hostname: config.web.host,
      port: config.web.port,
      idleTimeout: 0,
      fetch: Http.web(machine, queue).fetch,
    })
    log.info({ etc: paths.etc.root, api: api.url.origin, web: web.url.origin }, 'bicycle daemon listening')
  }
}
