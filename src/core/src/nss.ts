import type { Host } from '@bicycle/core/host'

export namespace Nss {
  async function id(host: Host, db: 'passwd' | 'group', name: string): Promise<number | null> {
    const r = await host.exec(['getent', db, name])
    if (r.code !== 0) return null
    const found = Number(r.stdout.trim().split(':')[2])
    return Number.isInteger(found) ? found : null
  }

  export const uid = (host: Host, name: string): Promise<number | null> => id(host, 'passwd', name)

  export const gid = (host: Host, name: string): Promise<number | null> => id(host, 'group', name)
}
