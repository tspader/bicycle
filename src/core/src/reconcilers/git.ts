import path from 'path'
import { Disk } from '@bicycle/core/disk'
import type { Host } from '@bicycle/core/host'

export namespace Git {
  export type Checkout = {
    repo: string
    ref: string
    dest: string
    sparse: string[]
  }

  const SAFE = ['-c', 'safe.directory=*']

  async function run(host: Host, dest: string, label: string, args: string[]): Promise<void> {
    const r = await host.exec(['git', ...SAFE, '-C', dest, ...args])
    if (r.code === 0) return
    const detail = r.stderr.trim() || r.stdout.trim() || '(no output)'
    throw new Error(`git ${label} failed (exit ${r.code}): ${detail}`)
  }

  export async function ensure(host: Host, { repo, ref, dest, sparse }: Checkout): Promise<void> {
    if (!Disk.exists(host.disk, path.join(dest, '.git'))) {
      host.disk.mkdir(dest)
      await run(host, dest, 'init', ['init', '-q'])
      await run(host, dest, 'remote add', ['remote', 'add', 'origin', repo])
      await run(host, dest, 'config sparseCheckout', ['config', 'core.sparseCheckout', 'true'])
      await run(host, dest, 'sparse-checkout init', ['sparse-checkout', 'init', '--cone'])
    }
    await run(host, dest, 'sparse-checkout set', ['sparse-checkout', 'set', ...sparse])
    await run(host, dest, `fetch ${ref} from ${repo}`, ['fetch', '--depth', '1', 'origin', ref])
    await run(host, dest, 'checkout FETCH_HEAD', ['checkout', '-q', 'FETCH_HEAD'])
  }
}
