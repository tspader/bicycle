import { randomUUID } from 'node:crypto'

// Anything that requires querying or generating values from a real machine
// goes through this interface so tests can stub it.
export type MachineCtx = {
  uuid(): string
  // Total size of the block device at `devicePath`, in bytes. Throws if the
  // device can't be inspected.
  diskSize(devicePath: string): number
}

export const liveMachine = (): MachineCtx => ({
  uuid: () => randomUUID(),
  diskSize: (path) => {
    const res = Bun.spawnSync(['lsblk', '-bdno', 'SIZE', path])
    const out = new TextDecoder().decode(res.stdout).trim()
    const n = Number(out)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`lsblk could not determine size for ${path}: ${out || '<empty>'}`)
    }
    return n
  },
})

// Deterministic stub for tests. UUIDs are sequential; disk sizes must be
// declared up-front (any unmocked device throws).
export const testMachine = (opts: { disks?: Record<string, number> } = {}): MachineCtx => {
  let counter = 0
  return {
    uuid: () => {
      counter += 1
      return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
    },
    diskSize: (path) => {
      const size = opts.disks?.[path]
      if (size === undefined) throw new Error(`testMachine: no diskSize configured for ${path}`)
      return size
    },
  }
}
