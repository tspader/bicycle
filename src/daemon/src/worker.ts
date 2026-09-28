import { Detect } from '@bicycle/core/detect'
import type { Host } from '@bicycle/core/host'
import { Ignores } from '@bicycle/core/ignores'
import { Kinds } from '@bicycle/core/kinds'
import { Log } from '@bicycle/core/log'
import { Reconcilers } from '@bicycle/core/reconcilers'
import type { Jobs } from '@bicycle/daemon/jobs'

export namespace Fail {
  export type Data = {
    failed: { errors: string[] }
  }
  export type Kind = keyof Data

  const messages: { [K in Kind]: (data: Data[K]) => string } = {
    failed: (d) => `${d.errors.length} error(s): ${d.errors.join('; ')}`,
  }

  export class Error<K extends Kind = Kind> extends globalThis.Error {
    constructor(
      readonly kind: K,
      readonly data: Data[K],
    ) {
      super((messages[kind] as (data: Data[K]) => string)(data))
      this.name = 'WorkerError'
    }
  }
}

export namespace Worker {
  export type Progress = (progress: Detect.Progress) => void

  export async function perform(host: Host, work: Jobs.Work, progress: Progress): Promise<Detect.Outcome[]> {
    switch (work.kind) {
      case 'reconcile':
        await Reconcilers.run(host, work.only)
        return []
      case 'app':
        await Reconcilers.app(host, work.name)
        return []
      case 'scan':
        return Detect.scan(host, {
          detectors: Detect.detectors(host).filter((det) => work.only.includes(det.name)),
          ignores: Ignores.effective(host),
          claims: Kinds.claims(host),
          priority: work.priority,
          timeout: work.timeout,
          progress,
        })
    }
  }

  export async function once(host: Host, only: Reconcilers.Name[]): Promise<void> {
    const errors: string[] = []
    const log = Log.to((line) => {
      host.log[line.level](line.data, line.msg)
      if (line.level === 'error') errors.push(line.msg)
    })
    await perform({ ...host, log }, { kind: 'reconcile', only }, () => {})
    if (errors.length > 0) throw new Fail.Error('failed', { errors })
  }

  const plain = (data: Log.Data): Log.Data =>
    JSON.parse(JSON.stringify(data, (_, value) => (value instanceof Error ? value.message : value)))

  export const real = (host: Host, emit: (message: Jobs.Message) => void): Jobs.Worker => ({
    start: (id, work) => {
      const log = Log.to((line) => {
        host.log[line.level](line.data, line.msg)
        emit({ kind: 'line', id, line: { ...line, data: plain(line.data) } })
      })
      perform({ ...host, log }, work, (progress) => emit({ kind: 'progress', id, progress }))
        .then((outcomes) => emit({ kind: 'ended', id, outcomes }))
        .catch((e) => emit({ kind: 'failed', id, message: e instanceof Error ? e.message : String(e) }))
    },
  })
}
