import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Render } from '@bicycle/cli/render'
import { Shared } from '@bicycle/cli/shared'

export namespace Scan {
  const Args = z.object({
    only: Shared.only(z.coerce.string()),
    'timeout-mins': z.number().positive(),
    foreground: z.boolean(),
  })

  export const command = (d: Shared.Deps): Command => ({
    description:
      'Have the daemon run its detectors and keep what they find for diff, and follow it until it is done; exits 1 when a detector failed',
    summary: 'Refresh expensive system scans',
    options: {
      only: { type: 'array', description: 'detectors to run; every detector when not given' },
      'timeout-mins': { type: 'number', description: 'minutes each detector gets', default: 60 },
      foreground: { type: 'boolean', description: 'full scheduling priority instead of idle', default: false },
    },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        const job = await d.client.submit({
          kind: 'scan',
          ...Shared.some(a.only),
          priority: a.foreground ? 'full' : 'idle',
          timeout: Math.round(a['timeout-mins'] * 60_000),
        })
        const done = await Shared.follow(d, job.id)
        for (const outcome of done.outcomes) d.sys.print(Render.outcome(outcome))
        Shared.settle(d, done)
      }),
  })
}
