import fs from 'fs'
import path from 'path'
import pino from 'pino'
import pretty from 'pino-pretty'
import type { Log } from '@bicycle/core/log'

export namespace Logs {
  function file(dir: string): pino.DestinationStream[] {
    try {
      fs.mkdirSync(dir, { recursive: true })
      return [pino.destination({ dest: path.join(dir, 'bicycle.log'), sync: true })]
    } catch {
      return []
    }
  }

  export function sink(dir: string, level: Log.Level): Log.Sink {
    const streams = [pretty({ colorize: true }), ...file(dir)].map((stream) => ({ stream }))
    const logger = pino({ level }, pino.multistream(streams))
    return (line) => logger[line.level](line.data, line.msg)
  }
}
