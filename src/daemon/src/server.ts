import { Hono } from 'hono'
import type { Host } from '@bicycle/core/host'
import { Api } from '@bicycle/daemon/api'
import type { Jobs } from '@bicycle/daemon/jobs'
import { Web } from '@bicycle/daemon/web'

export namespace Http {
  export const api = (host: Host, queue: Jobs.Queue): Hono => new Hono().route('/api', Api.routes(host, queue))

  export const web = Web.routes
}
