import type { Host } from '@bicycle/core/host'

export namespace Network {
  const NAME = 'bicycle'

  export async function ensure(host: Host): Promise<void> {
    const found = await host.exec(['docker', 'network', 'inspect', NAME])
    if (found.code === 0) return
    host.log.info({ network: NAME }, 'network: creating')
    const made = await host.exec(['docker', 'network', 'create', NAME])
    if (made.code !== 0) throw new Error(`docker network create ${NAME} failed: ${made.stderr.trim()}`)
    host.log.info({ network: NAME }, 'network: created')
  }
}
