import type { Child } from 'hono/jsx'
import { BootView } from '../views/boot'
import { kernelSignals } from '../views/kernels'
import { bootloaderSignals } from '../views/bootloader'
import { editNode } from '../state'
import { configState, editHandler } from '../render'

export const bootBody = (): Child => {
  const { bike } = configState()
  const b = bike.boot ?? { loader: 'systemd-boot' as const, uki: true, removable: false }
  return (
    <BootView
      kernel={bike.core?.kernels?.[0] ?? 'linux'}
      bootloader={{ loader: b.loader, uki: b.uki, removable: b.removable }}
    />
  )
}

export const kernels = editHandler(kernelSignals, (d) => editNode(['core', 'kernels'], [d.kernel]))
export const bootloader = editHandler(bootloaderSignals, (d) =>
  editNode(['boot'], { loader: d.loader, uki: d.uki, removable: d.removable }))
