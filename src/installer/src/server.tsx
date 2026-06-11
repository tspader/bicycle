import { Hono } from 'hono'
import { z } from 'zod'
import type { Child } from 'hono/jsx'
import { syncPacman } from './system'
import { serve, env as runtimeEnv } from './runtime'
import { CATEGORY_IDS, type CategoryId } from './ui-state'
import * as api from './api'
import { type App, type AppContext, readSignals } from './http'
import { routes, type PlainRoute } from './routes'
import { renderPage } from './render'
import appCssPath from "./assets/app.css" with { type: "file" }
import appJsPath from "./assets/app.js" with { type: "file" }
import datastarPath from "./assets/datastar.js" with { type: "file" }
import faviconPath from "./assets/favicon.ico" with { type: "file" }

const app = new Hono<{ Variables: App }>()

app.use('*', readSignals)

const staticFile = (path: string, type: string) => () =>
  new Response(Bun.file(path), { headers: { 'content-type': type } })

app.get('/static/app.css', staticFile(appCssPath, 'text/css; charset=utf-8'))
app.get('/static/app.js', staticFile(appJsPath, 'application/javascript; charset=utf-8'))
app.get('/static/datastar.js', staticFile(datastarPath, 'application/javascript; charset=utf-8'))
app.get('/favicon.ico', staticFile(faviconPath, 'image/x-icon'))

app.get('/', (c) => c.redirect('/config/system'))

const CategoryParam = z.enum(CATEGORY_IDS)

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

type Handler = (c: AppContext) => Response | Promise<Response>

const mount = (route: Pick<PlainRoute, 'method' | 'path'>, handler: Handler): void => {
  app[route.method](route.path, handler)
}

mount(routes.hostname, api.system.hostname)
mount(routes.timezone, api.system.timezone)
mount(routes.ntp, api.system.ntp)
mount(routes.network, api.system.network)
mount(routes.locale, api.system.locale)

mount(routes.kernels, api.boot.kernels)
mount(routes.bootloader, api.boot.bootloader)

mount(routes.swap, api.disk.swap)
mount(routes.diskOpen, api.disk.open)
mount(routes.diskPreset, api.disk.preset)
mount(routes.partitionAdd, api.disk.partitionAdd)
mount(routes.partitionDelete, api.disk.partitionDelete)
mount(routes.partitionSave, api.disk.partitionSave)
mount(routes.subvolAdd, api.disk.subvolAdd)
mount(routes.subvolDelete, api.disk.subvolDelete)
mount(routes.subvolSave, api.disk.subvolSave)
mount(routes.encryptionType, api.disk.encryptionType)
mount(routes.encryptionPassword, api.disk.encryptionPassword)

mount(routes.importGit, api.clone.git)
mount(routes.ageKeySet, api.secrets.setKey)
mount(routes.ageKeyFile, api.secrets.setKeyFile)
mount(routes.ageKeyClear, api.secrets.clearKey)
mount(routes.mirrorsToggle, api.mirrors.toggle)
mount(routes.mirrorsList, api.mirrors.list)
mount(routes.packagesToggle, api.packages.toggle)
mount(routes.packagesList, api.packages.list)
mount(routes.packagesDetail, api.packages.detail)
mount(routes.usersAdd, api.users.add)
mount(routes.usersOpen, api.users.open)
mount(routes.usersClose, api.users.close)
mount(routes.usersDelete, api.users.remove)
mount(routes.usersGroupAdd, api.users.groupAdd)
mount(routes.usersGroupRemove, api.users.groupRemove)
mount(routes.usersName, api.users.name)
mount(routes.usersSudo, api.users.sudo)
mount(routes.usersPassword, api.users.password)
mount(routes.usersRoot, api.users.root)

mount(routes.configJson, api.install.configJson)
mount(routes.installPage, api.install.page)
mount(routes.installTick, api.install.tick)
mount(routes.installStatus, api.install.status)
mount(routes.installStart, api.install.start)
mount(routes.installReboot, api.install.reboot)
mount(routes.installReset, api.install.reset)

const start = async () => {
  syncPacman().then((res) => {
    if (!res.ok) console.warn('[pacman -Sy] failed:', res.error)
    else console.log('[pacman -Sy] ok')
  })
  serve({ port: Number(runtimeEnv.PORT ?? 8080), fetch: app.fetch })
}

start()
