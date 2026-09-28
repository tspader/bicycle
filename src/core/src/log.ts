import { z } from 'zod'

export interface Log {
  debug: Log.Write
  info: Log.Write
  warn: Log.Write
  error: Log.Write
}

export namespace Log {
  export const Level = z.enum(['debug', 'info', 'warn', 'error'])
  export type Level = z.infer<typeof Level>
  export const Line = z.object({ level: Level, msg: z.string(), data: z.record(z.string(), z.unknown()) })
  export type Line = z.infer<typeof Line>
  export type Data = Line['data']
  export type Write = (data: Data, msg: string) => void
  export type Sink = (line: Line) => void

  export const to = (sink: Sink): Log => ({
    debug: (data, msg) => sink({ level: 'debug', msg, data }),
    info: (data, msg) => sink({ level: 'info', msg, data }),
    warn: (data, msg) => sink({ level: 'warn', msg, data }),
    error: (data, msg) => sink({ level: 'error', msg, data }),
  })
}
