import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { Shared } from '@bicycle/cli/shared'

export namespace Reconcile {
  const Args = z.object({ only: Shared.only(Reconcilers.Name) })

  export const command = (d: Shared.Deps): Command => ({
    description: 'Have the daemon reconcile the machine and follow it until it is done; exits 1 when anything failed',
    summary: 'Reconcile now',
    options: {
      only: {
        type: 'array',
        description: `reconcilers to run, of ${Reconcilers.ORDER.join(', ')}; all when not given`,
      },
    },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        const job = await d.client.submit({ kind: 'reconcile', ...Shared.some(a.only) })
        Shared.settle(d, await Shared.follow(d, job.id))
      }),
  })
}
