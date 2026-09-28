import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Shared } from '@bicycle/cli/shared'

export namespace Secret {
  const Args = z.object({ addr: z.string() })

  const addr = { type: 'string', description: 'secret address, like miniflux/db-password', required: true } as const

  const NEWLINE = 0x0a

  const chomp = (bytes: Uint8Array): Uint8Array => (bytes.at(-1) === NEWLINE ? bytes.subarray(0, -1) : bytes)

  const set = (d: Shared.Deps): Command => ({
    description: 'Encrypt stdin, less one trailing newline, to the recipients and keep it in the tree',
    summary: 'Create or replace a secret',
    positionals: { addr },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        await d.client.seal(a.addr, chomp(await d.sys.input()))
      }),
  })

  const get = (d: Shared.Deps): Command => ({
    description: 'Decrypt a secret and print it',
    summary: 'Read a secret',
    positionals: { addr },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        d.sys.print(await d.client.secret(a.addr))
      }),
  })

  const ls = (d: Shared.Deps): Command => ({
    description: 'List the address of every secret in the tree',
    summary: 'List secrets',
    handler: () =>
      Shared.guard(d, async () => {
        d.sys.print((await d.client.secrets()).join('\n'))
      }),
  })

  const rm = (d: Shared.Deps): Command => ({
    description: 'Delete a secret from the tree',
    summary: 'Remove a secret',
    positionals: { addr },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        await d.client.forget(a.addr)
      }),
  })

  export const command = (d: Shared.Deps): Command => ({
    description: 'Manage the age-encrypted secrets in the tree, through the daemon',
    summary: 'Create, read, list and delete secrets',
    commands: { set: set(d), get: get(d), ls: ls(d), rm: rm(d) },
  })
}
