import type { Command } from '@spader/zargs'
import { z } from 'zod'
import { Reconcilers } from '@bicycle/core/reconcilers'
import { Shared } from '@bicycle/cli/shared'

export namespace Daemon {
  const Once = z.object({ only: Shared.only(Reconcilers.Name) })

  const run = (d: Shared.Deps): Command => ({
    description: 'Run the daemon in the foreground: watch the tree, reconcile, and serve the API and the web UI',
    summary: 'Run the daemon',
    handler: () => Shared.guard(d, async () => d.daemon.run()),
  })

  const once = (d: Shared.Deps): Command => ({
    description:
      'Reconcile once in this process and exit, with no daemon; what the installer runs in the chroot before first boot',
    summary: 'Reconcile once, with no daemon',
    options: {
      only: {
        type: 'array',
        description: `reconcilers to run, of ${Reconcilers.ORDER.join(', ')}; all when not given`,
      },
    },
    handler: (argv) =>
      Shared.guard(d, async () => {
        const a = Shared.parse(Once, argv)
        await d.daemon.once(a.only.length === 0 ? [...Reconcilers.ORDER] : a.only)
      }),
  })

  export const command = (d: Shared.Deps): Command => ({
    description: 'Run the daemon, or its work once',
    summary: 'Run the daemon',
    commands: { run: run(d), once: once(d) },
  })
}
