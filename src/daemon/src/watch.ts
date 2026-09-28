import path from 'path'
import type { Paths } from '@bicycle/core/paths'
import { Reconcilers } from '@bicycle/core/reconcilers'
import type { Jobs } from '@bicycle/daemon/jobs'

export namespace Watch {
  export const QUIET = 250

  const INPUTS = new Set(['config.yml', 'compose.yml'])

  const under = (dir: string, file: string): boolean => file.startsWith(dir + path.sep)

  export function classify(paths: Paths, file: string): Jobs.Work | null {
    if (file === paths.etc.bicycle) return { kind: 'reconcile', only: [...Reconcilers.ORDER] }
    if (file === paths.etc.secrets || under(paths.etc.secrets, file)) {
      return { kind: 'reconcile', only: ['files', 'app'] }
    }
    if (under(paths.etc.files, file)) return { kind: 'reconcile', only: ['files'] }
    if (!under(paths.etc.apps, file)) return null
    const [name, ...rest] = path.relative(paths.etc.apps, file).split(path.sep)
    if (name === undefined || rest.length === 0 || !INPUTS.has(path.basename(file))) return null
    return { kind: 'app', name }
  }
}
