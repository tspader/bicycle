import type { Cli as Def } from '@spader/zargs'
import { Daemon } from '@bicycle/cli/commands/daemon'
import { Diff } from '@bicycle/cli/commands/diff'
import { Jobs } from '@bicycle/cli/commands/jobs'
import { Reconcile } from '@bicycle/cli/commands/reconcile'
import { Scan } from '@bicycle/cli/commands/scan'
import { Secret } from '@bicycle/cli/commands/secret'
import type { Shared } from '@bicycle/cli/shared'

export namespace Cli {
  export const cli = (d: Shared.Deps): Def => ({
    name: 'bicycle',
    description: 'Just like one',
    version: '0.1.0',
    commands: {
      diff: Diff.command(d),
      reconcile: Reconcile.command(d),
      scan: Scan.command(d),
      jobs: Jobs.command(d),
      secret: Secret.command(d),
      daemon: Daemon.command(d),
    },
  })
}
