import { Clock } from '@bicycle/core/clock'
import { Disk } from '@bicycle/core/disk'
import type { Log } from '@bicycle/core/log'
import type { Paths } from '@bicycle/core/paths'

export interface Host {
  paths: Paths
  log: Log
  clock: Clock
  disk: Disk
  exec: (cmd: string[], run?: Host.Run) => Promise<Host.Result>
  spawn: (cmd: string[], env: Record<string, string>) => Host.Proc
}

export namespace Host {
  export type Vars = Record<string, string | undefined>
  export type Run = { env?: Record<string, string>; stdin?: string }
  export type Result = { code: number; stdout: string; stderr: string }
  export type Signal = 'SIGTERM' | 'SIGKILL'
  export type Proc = {
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    exited: Promise<number>
    kill: (signal: Signal) => void
  }

  export function real(paths: Paths, log: Log, vars: Vars): Host {
    const PATH = vars.PATH ?? ''
    const which = (name: string) => Bun.which(name, { PATH })
    const spawn = (cmd: string[], env: Record<string, string>, stdin?: string) =>
      Bun.spawn(cmd, {
        env: { ...vars, ...env },
        stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
        stdout: 'pipe',
        stderr: 'pipe',
      })
    return {
      paths,
      log,
      clock: Clock.real(),
      disk: Disk.real(PATH),
      exec: async (cmd, run = {}) => {
        const bin = which(cmd[0]!)
        if (bin === null) return { code: 127, stdout: '', stderr: `${cmd[0]}: command not found` }
        const proc = spawn([bin, ...cmd.slice(1)], run.env ?? {}, run.stdin)
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ])
        return { code, stdout, stderr }
      },
      spawn: (cmd, env) => {
        const bin = which(cmd[0]!)
        if (bin === null) throw new Error(`${cmd[0]}: command not found`)
        const proc = spawn([bin, ...cmd.slice(1)], env)
        return {
          stdout: proc.stdout,
          stderr: proc.stderr,
          exited: proc.exited,
          kill: (signal) => proc.kill(signal),
        }
      },
    }
  }
}
