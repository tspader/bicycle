import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Render } from '@bicycle/cli/render'
import { Shared } from '@bicycle/cli/shared'

export namespace Diff {
  const Args = z.object({ only: Shared.only(z.coerce.string()), json: z.boolean() })

  export const command = (d: Shared.Deps): Command => ({
    description:
      'Show what diverges between the declared and the actual machine, as the daemon sees it, without changing anything; exits 1 when anything does',
    summary: 'Show what reconcile would change',
    options: {
      only: { type: 'array', description: 'kinds to plan; every kind when not given' },
      json: { type: 'boolean', description: 'one JSON diff per line', default: false },
    },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Args, argv)
        const plan = await d.client.plan(a.only)
        d.sys.print(a.json ? plan.diffs.map((diff) => JSON.stringify(diff)).join('\n') : Render.plan(plan, d.clock.now()))
        d.sys.exit(plan.diffs.length === 0 ? 0 : 1)
      }),
  })
}
