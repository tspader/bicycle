#!/usr/bin/env bun
import { build, defaultTheme, type Theme } from '@spader/zargs'
import { Clock } from '@bicycle/core/clock'
import { Daemon } from '@bicycle/daemon'
import { Client } from '@bicycle/daemon/client'
import { Config } from '@bicycle/daemon/config'
import { Net } from '@bicycle/daemon/net'
import { Cli } from '@bicycle/cli/cli'
import type { Shared } from '@bicycle/cli/shared'
import { Sys } from '@bicycle/cli/sys'

async function main() {
  if (process.env.NO_COLOR !== undefined || !process.stdout.isTTY) {
    for (const key of Object.keys(defaultTheme) as (keyof Theme)[]) {
      defaultTheme[key] = (value) => value
    }
  }
  const config = Config.init(process.env)
  const d: Shared.Deps = {
    client: Client(config.daemon, Net.real()),
    daemon: {
      run: () => Daemon.run(config, process.env),
      once: (only) => Daemon.once(config, process.env, only),
    },
    clock: Clock.real(),
    sys: Sys.real(),
  }
  await build(Cli.cli(d)).parseAsync()
}

await main()
