import type { Reconcilers } from '@bicycle/core/reconcilers'
import { Fail as ClientFail } from '@bicycle/daemon/client'
import { Testing as Daemon } from '@bicycle/daemon/testing'
import { Fail as CliFail } from '@bicycle/cli/error'
import type { Shared } from '@bicycle/cli/shared'
import type { Sys } from '@bicycle/cli/sys'

export namespace Testing {
  export const each = Daemon.each
  export const net = Daemon.net
  export const time = Daemon.time
  export const drive = Daemon.drive
  export const job = Daemon.job
  export const epoch = Daemon.epoch

  export type Reply = Daemon.Reply
  export type Hit = Daemon.Hit

  export type Ran = { kind: 'run' } | { kind: 'once'; only: Reconcilers.Name[] }

  export type Seen = {
    out: string[]
    err: string[]
    code: number
    ran: Ran[]
  }

  export type Fake = { sys: Sys.Host; daemon: Shared.Daemon; seen: Seen }

  export function fake(input: string, failure: string | null): Fake {
    const seen: Seen = { out: [], err: [], code: 0, ran: [] }
    return {
      seen,
      daemon: {
        run: () => {
          seen.ran.push({ kind: 'run' })
        },
        once: async (only) => {
          seen.ran.push({ kind: 'once', only })
          if (failure !== null) throw new Error(failure)
        },
      },
      sys: {
        print: (text) => {
          seen.out.push(text)
        },
        status: () => {},
        fail: (error) => {
          seen.err.push(
            error instanceof CliFail.Error || error instanceof ClientFail.Error ? error.kind : String(error),
          )
          seen.code = 1
        },
        exit: (code) => {
          seen.code = code
        },
        input: async () => new TextEncoder().encode(input),
      },
    }
  }
}
