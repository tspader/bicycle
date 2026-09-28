import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import { Log } from '@bicycle/core/log'

export namespace Fail {
  export type Data = {
    'bad-config': { source: string; issues: z.core.$ZodIssue[] }
    'bad-json': { file: string; reason: string }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    'bad-config': (d) => `${d.source}: ${d.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    'bad-json': (d) => `${d.file} is not JSON: ${d.reason}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'ConfigError'
    }
  }
}

export interface Config {
  etc: string
  state: string
  run: string
  root: string
  key: string
  scanner: string
  host: string
  port: number
  web: { host: string; port: number }
  daemon: string
  level: Log.Level
}

export namespace Config {
  export const environment = 'the environment'
  export const FILE = '/etc/bicycle.json'

  export type Vars = Record<string, string | undefined>

  const Port = z.number().int().min(1).max(65535)

  const Env = z.object({
    BICYCLE_CONFIG: z.string().optional(),
    BICYCLE_ETC: z.string().optional(),
    BICYCLE_VAR: z.string().optional(),
    BICYCLE_RUN: z.string().optional(),
    BICYCLE_HOST_ROOT: z.string().optional(),
    AGE_KEY: z.string().optional(),
    BICYCLE_FS_SCANNER: z.string().optional(),
    BICYCLE_HOST: z.string().optional(),
    BICYCLE_PORT: z.coerce.number().pipe(Port).optional(),
    BICYCLE_WEB_HOST: z.string().optional(),
    BICYCLE_WEB_PORT: z.coerce.number().pipe(Port).optional(),
    BICYCLE_DAEMON_URL: z.string().optional(),
    LOG_LEVEL: Log.Level.optional(),
  })

  const File = z.strictObject({
    etc: z.string().optional(),
    state: z.string().optional(),
    run: z.string().optional(),
    root: z.string().optional(),
    key: z.string().optional(),
    scanner: z.string().optional(),
    host: z.string().optional(),
    port: Port.optional(),
    web: z.strictObject({ host: z.string().optional(), port: Port.optional() }).optional(),
    daemon: z.string().optional(),
    level: Log.Level.optional(),
  })

  const set = (vars: Vars): Vars =>
    Object.fromEntries(Object.entries(vars).filter(([, value]) => value !== undefined && value !== ''))

  function check<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
    const result = schema.safeParse(value)
    if (result.success) return result.data
    throw new Fail.Error('bad-config', { source, issues: result.error.issues })
  }

  function json(file: string): unknown {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Fail.Error('bad-json', { file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  export function parse(vars: Vars, raw: unknown, source: string): Config {
    const env = check(Env, set(vars), environment)
    const file = check(File, raw, source)
    const etc = env.BICYCLE_ETC ?? file.etc ?? '/etc/bicycle'
    const host = env.BICYCLE_HOST ?? file.host ?? '127.0.0.1'
    const port = env.BICYCLE_PORT ?? file.port ?? 7777
    const url = env.BICYCLE_DAEMON_URL ?? file.daemon ?? `http://${host}:${port}`
    return {
      etc,
      state: env.BICYCLE_VAR ?? file.state ?? '/var/lib/bicycle',
      run: env.BICYCLE_RUN ?? file.run ?? '/run/bicycle',
      root: env.BICYCLE_HOST_ROOT ?? file.root ?? '/',
      key: env.AGE_KEY ?? file.key ?? path.join(etc, 'age.key'),
      scanner: env.BICYCLE_FS_SCANNER ?? file.scanner ?? 'bicycle-fs-scan',
      host,
      port,
      web: {
        host: env.BICYCLE_WEB_HOST ?? file.web?.host ?? '127.0.0.1',
        port: env.BICYCLE_WEB_PORT ?? file.web?.port ?? 8081,
      },
      daemon: url.replace(/\/$/, ''),
      level: env.LOG_LEVEL ?? file.level ?? 'info',
    }
  }

  export function init(vars: Vars): Config {
    const env = check(Env, set(vars), environment)
    const file = env.BICYCLE_CONFIG ?? FILE
    return parse(vars, fs.existsSync(file) ? json(file) : {}, file)
  }
}
