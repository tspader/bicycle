#!/usr/bin/env bun
import daemon from './build/daemon.ts'
import pacman from './build/pacman.ts'

const main = async () => {
  await daemon()
  await pacman()
}

await main()
