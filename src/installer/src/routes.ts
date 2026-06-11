import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { type Code, get, post } from './datastar'
import type { AppContext } from './http'

type Method = 'get' | 'post'

export type PlainRoute = {
  method: Method
  path: string
  url: () => string
  action: () => Code<void>
}

export type ParamRoute<S extends z.ZodRawShape> = {
  method: Method
  path: string
  url: (params: z.input<z.ZodObject<S>>) => string
  action: (params: z.input<z.ZodObject<S>>) => Code<void>
  params: (c: AppContext) => z.output<z.ZodObject<S>>
}

const actions = { get, post }

export function route(method: Method, path: string): PlainRoute
export function route<S extends z.ZodRawShape>(method: Method, path: string, query: S): ParamRoute<S>
export function route(method: Method, path: string, query?: z.ZodRawShape) {
  if (!query) {
    return { method, path, url: () => path, action: () => actions[method](path) }
  }
  const schema = z.object(query)
  const url = (params: Record<string, unknown>): string => {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value))
    }
    const s = qs.toString()
    return s ? `${path}?${s}` : path
  }
  return {
    method,
    path,
    url,
    action: (params: Record<string, unknown>) => actions[method](url(params)),
    params: (c: AppContext) => {
      const parsed = schema.safeParse(c.req.query())
      if (!parsed.success) {
        throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'invalid query' })
      }
      return parsed.data
    },
  }
}

const index = z.coerce.number().int().min(0)
const device = { device: z.string().min(1) }
const deviceIdx = { ...device, idx: index }
const subvol = { ...deviceIdx, subIdx: index }

export const routes = {
  hostname: route('post', '/api/hostname'),
  timezone: route('post', '/api/timezone'),
  ntp: route('post', '/api/ntp'),
  network: route('post', '/api/network'),
  locale: route('post', '/api/locale'),
  kernels: route('post', '/api/kernels'),
  bootloader: route('post', '/api/bootloader'),
  swap: route('post', '/api/swap'),
  diskOpen: route('post', '/api/disk/open', { device: z.string().min(1).optional() }),
  diskPreset: route('post', '/api/disk/preset', { ...device, id: z.string().min(1) }),
  partitionAdd: route('post', '/api/disk/partition/add', device),
  partitionDelete: route('post', '/api/disk/partition/delete', deviceIdx),
  partitionSave: route('post', '/api/disk/partition/save', deviceIdx),
  subvolAdd: route('post', '/api/disk/partition/subvol/add', deviceIdx),
  subvolDelete: route('post', '/api/disk/partition/subvol/delete', subvol),
  subvolSave: route('post', '/api/disk/partition/subvol/save', subvol),
  encryptionType: route('post', '/api/disk/encryption-type'),
  encryptionPassword: route('post', '/api/disk/encryption-password'),
  importGit: route('post', '/api/import/git'),
  ageKeySet: route('post', '/api/secrets/age-key'),
  ageKeyFile: route('post', '/api/secrets/age-key/file'),
  ageKeyClear: route('post', '/api/secrets/age-key/clear'),
  mirrorsToggle: route('post', '/api/mirrors/toggle', { name: z.string().min(1) }),
  mirrorsList: route('get', '/api/mirrors/list'),
  packagesToggle: route('post', '/api/packages/toggle', { name: z.string().min(1) }),
  packagesList: route('get', '/api/packages/list', {
    after: z.string().default(''),
    mode: z.enum(['outer', 'append']).default('outer'),
  }),
  packagesDetail: route('get', '/api/packages/detail', { name: z.string().min(1) }),
  usersAdd: route('post', '/api/users/add'),
  usersOpen: route('post', '/api/users/open', { idx: index }),
  usersClose: route('post', '/api/users/close'),
  usersDelete: route('post', '/api/users/delete', { idx: index }),
  usersGroupAdd: route('post', '/api/users/group/add', { idx: index }),
  usersGroupRemove: route('post', '/api/users/group/remove', { idx: index, g: index }),
  usersName: route('post', '/api/users/name', { idx: index }),
  usersSudo: route('post', '/api/users/sudo', { idx: index }),
  usersPassword: route('post', '/api/users/password', { idx: index }),
  usersRoot: route('post', '/api/users/root'),
  configJson: route('get', '/api/config.json'),
  installPage: route('get', '/install'),
  installTick: route('get', '/api/install/tick', { s: z.string().optional() }),
  installStatus: route('get', '/api/install/status'),
  installStart: route('post', '/api/install/start'),
  installReboot: route('post', '/api/install/reboot'),
  installReset: route('post', '/api/install/reset'),
}
