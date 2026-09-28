#!/usr/bin/env bun
import binary from './build/binary.ts'
import pacman from './build/pacman.ts'

const main = async () => {
  await binary()
  await pacman()
}

await main()
