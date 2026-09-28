import { z } from 'zod'
import type { Host } from '@bicycle/core/host'
import { App } from '@bicycle/core/reconcilers/app'
import { Dirs } from '@bicycle/core/reconcilers/dirs'
import { Files } from '@bicycle/core/reconcilers/files'
import { Groups } from '@bicycle/core/reconcilers/groups'
import { Ingress } from '@bicycle/core/reconcilers/ingress'
import { Packages } from '@bicycle/core/reconcilers/packages'
import { Sudoers } from '@bicycle/core/reconcilers/sudoers'
import { Systemd } from '@bicycle/core/reconcilers/systemd'
import { Users } from '@bicycle/core/reconcilers/users'

export namespace Reconcilers {
  export const ORDER = ['groups', 'users', 'sudoers', 'dirs', 'files', 'packages', 'systemd', 'app', 'ingress'] as const

  export const Name = z.enum(ORDER)
  export type Name = z.infer<typeof Name>

  const ALL: Record<Name, (host: Host) => Promise<void>> = {
    groups: Groups.all,
    users: Users.all,
    sudoers: Sudoers.all,
    dirs: Dirs.all,
    files: Files.all,
    packages: Packages.all,
    systemd: Systemd.all,
    app: App.all,
    ingress: Ingress.all,
  }

  export async function run(host: Host, names: readonly Name[]): Promise<void> {
    for (const name of ORDER) {
      if (names.includes(name)) await ALL[name](host)
    }
  }

  export async function app(host: Host, name: string): Promise<void> {
    await App.one(host, name)
    await Ingress.all(host)
  }
}
