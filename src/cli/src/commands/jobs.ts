import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Render } from '@bicycle/cli/render'
import { Shared } from '@bicycle/cli/shared'

export namespace Jobs {
  const Args = z.object({ id: z.string().optional(), limit: z.number().int().positive() })

  export const command = (d: Shared.Deps): Command => ({
    description: 'List what the daemon has been doing, newest first, or show one job with everything it logged',
    summary: 'List jobs, or show one',
    positionals: { id: { type: 'string', description: 'job id' } },
    options: { limit: { alias: 'n', type: 'number', description: 'max jobs', default: 20 } },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        if (a.id !== undefined) return d.sys.print(Render.detail(await d.client.job(a.id)))
        d.sys.print((await d.client.jobs(a.limit)).map(Render.job).join('\n'))
      }),
  })
}
