import { AppConfig, type BicycleConfig, loadBicycleDoc } from '@bicycle/shared'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'

export namespace Tree {
  export const bicycle = (host: Host): BicycleConfig =>
    loadBicycleDoc(Disk.text(host.disk, host.paths.etc.bicycle)).resolved

  export const maybe = (host: Host): BicycleConfig | null =>
    Disk.exists(host.disk, host.paths.etc.bicycle) ? bicycle(host) : null

  export const app = (host: Host, name: string): AppConfig =>
    AppConfig.parse(Bun.YAML.parse(Disk.text(host.disk, host.paths.etc.app(name).config)))
}
