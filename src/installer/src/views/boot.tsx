import { Page } from './layout'
import { KernelsSection } from './kernels'
import { BootloaderSection } from './bootloader'
import type { Kernel } from '../system'

type Props = {
  kernel: Kernel
  bootloader: { loader: 'systemd-boot' | 'grub' | 'efistub' | 'limine' | 'refind'; uki: boolean; removable: boolean }
}

export const BootView = ({ kernel, bootloader }: Props) => (
  <Page heading="Boot" subhead="Kernel and bootloader.">
    <KernelsSection selected={kernel} />
    <BootloaderSection loader={bootloader.loader} uki={bootloader.uki} removable={bootloader.removable} />
  </Page>
)
