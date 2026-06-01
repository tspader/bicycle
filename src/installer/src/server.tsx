import { Hono } from 'hono'
import { z } from 'zod'
import type { Child } from 'hono/jsx'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { CATEGORIES } from './views/layout'
import { syncPacman } from './system'
import { serve, env as runtimeEnv } from './runtime'
import { type CategoryId } from './ui-state'
import * as api from './api'
import { type App, type AppContext } from './http'
import { renderPage } from './render'
import appCssPath from "./assets/app.css" with { type: "file" }
import datastarPath from "./assets/datastar.js" with { type: "file" }
import faviconPath from "./assets/favicon.ico" with { type: "file" }

const app = new Hono<{ Variables: App }>()

app.use('*', async (c, next) => {
  const r = await ServerSentEventGenerator.readSignals(c.req.raw)
  c.set('signals', r.success ? r.signals : {})
  c.set('error', r.success ? null : r.error)
  c.set('datastar', c.req.raw.headers.get('datastar-request') === 'true')
  await next()
})

const staticFile = (path: string, type: string) => () =>
  new Response(Bun.file(path), { headers: { 'content-type': type } })

app.get('/static/app.css', staticFile(appCssPath, 'text/css; charset=utf-8'))
app.get('/static/datastar.js', staticFile(datastarPath, 'application/javascript; charset=utf-8'))
app.get('/favicon.ico', staticFile(faviconPath, 'image/x-icon'))

app.get('/', (c) => c.redirect('/config/system'))

const CategoryParam = z.enum(CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]])

const buildPage = async (cat: CategoryId, c: AppContext): Promise<Child> => {
  switch (cat) {
    case 'system':
      return api.system.systemBody()
    case 'users':
      return api.users.usersBody()
    case 'disk':
      return api.disk.diskBody(c)
    case 'pacman':
      return api.pacman.pacmanBody(c)
    case 'boot':
      return api.boot.bootBody()
    case 'import':
      return api.importer.importBody()
  }
}

app.get('/config/:category', async (c) => {
  const parsed = CategoryParam.safeParse(c.req.param('category'))
  if (!parsed.success) return c.redirect('/config/system')
  return renderPage(c, parsed.data, await buildPage(parsed.data, c))
})

app.post('/api/hostname', api.system.hostname)
app.post('/api/timezone', api.system.timezone)
app.post('/api/ntp', api.system.ntp)
app.post('/api/network', api.system.network)
app.post('/api/locale', api.system.locale)

app.post('/api/kernels', api.boot.kernels)
app.post('/api/bootloader', api.boot.bootloader)

app.post('/api/swap', api.disk.swap)
app.post('/api/disk/open', api.disk.open)
app.post('/api/disk/preset', api.disk.preset)
app.post('/api/disk/partition/add', api.disk.partitionAdd)
app.post('/api/disk/partition/delete', api.disk.partitionDelete)
app.post('/api/disk/partition/save', api.disk.partitionSave)
app.post('/api/disk/partition/subvol/add', api.disk.subvolAdd)
app.post('/api/disk/partition/subvol/delete', api.disk.subvolDelete)
app.post('/api/disk/partition/subvol/save', api.disk.subvolSave)
app.post('/api/disk/encryption-type', api.disk.encryptionType)
app.post('/api/disk/encryption-password', api.disk.encryptionPassword)

app.post('/api/import/git', api.clone.git)
app.post('/api/secrets/age-key', api.secrets.setKey)
app.post('/api/secrets/age-key/clear', api.secrets.clearKey)
app.post('/api/mirrors/toggle', api.mirrors.toggle)
app.get('/api/mirrors/list', api.mirrors.list)
app.post('/api/packages/toggle', api.packages.toggle)
app.get('/api/packages/list', api.packages.list)
app.get('/api/packages/detail', api.packages.detail)
app.post('/api/users/add', api.users.add)
app.post('/api/users/open', api.users.open)
app.post('/api/users/close', api.users.close)
app.post('/api/users/delete', api.users.remove)
app.post('/api/users/group/add', api.users.groupAdd)
app.post('/api/users/group/remove', api.users.groupRemove)
app.post('/api/users/name', api.users.name)
app.post('/api/users/sudo', api.users.sudo)
app.post('/api/users/password', api.users.password)
app.post('/api/users/root', api.users.root)

app.get('/api/config.json', api.install.configJson)

app.get('/install', api.install.page)
app.get('/api/install/tick', api.install.tick)
app.get('/api/install/status', api.install.status)
app.post('/api/install/start', api.install.start)
app.post('/api/install/reboot', api.install.reboot)
app.post('/api/install/reset', api.install.reset)

const start = async () => {
  syncPacman().then((res) => {
    if (!res.ok) console.warn('[pacman -Sy] failed:', res.error)
    else console.log('[pacman -Sy] ok')
  })
  serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })
}

start()
