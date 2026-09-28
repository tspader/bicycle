import type { Detect } from '@bicycle/core/detect'
import type { Kinds } from '@bicycle/core/kinds'
import { Render as Diffs } from '@bicycle/core/kinds/render'
import type { Log } from '@bicycle/core/log'
import type { Jobs } from '@bicycle/daemon/jobs'

export namespace Render {
  const scanned = (entry: Kinds.Planned, now: Date): string[] => {
    if (entry.scannedAt === undefined) return []
    if (entry.scannedAt === null) return [`# ${entry.kind}: never scanned`]
    return [`# ${entry.kind}: scanned ${Diffs.ago(entry.scannedAt, now)}`]
  }

  export function plan(plan: Kinds.Plan, now: Date): string {
    const ignored = plan.ignored > 0 ? ` (${plan.ignored} ignored)` : ''
    return [
      ...plan.diffs.map(Diffs.line),
      ...plan.kinds.flatMap((entry) => scanned(entry, now)),
      plan.diffs.length === 0 ? `clean${ignored}` : `${plan.diffs.length} diff(s)${ignored}`,
    ].join('\n')
  }

  const pair = ([key, value]: [string, unknown]): string =>
    `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`

  export const line = (line: Log.Line): string =>
    [line.level.padEnd(5), line.msg, ...Object.entries(line.data).map(pair)].join('  ')

  export const progress = (p: Detect.Progress): string =>
    `${p.detector}: ${p.done}${p.total === undefined ? '' : `/${p.total}`} ${p.msg ?? ''}`

  export function work(work: Jobs.Work): string {
    switch (work.kind) {
      case 'reconcile':
        return `reconcile ${work.only.join(',')}`
      case 'app':
        return `app ${work.name}`
      case 'scan':
        return `scan ${work.only.join(',')}`
    }
  }

  export function outcome(outcome: Detect.Outcome): string {
    switch (outcome.kind) {
      case 'scanned':
        return `${outcome.detector}: ${outcome.findings} finding(s)`
      case 'failed':
        return `${outcome.detector}: failed (${outcome.message})`
    }
  }

  export const job = (job: Jobs.Job): string =>
    [job.id, job.status, job.trigger, work(job.work), job.created].join('  ')

  export const detail = (job: Jobs.Job): string =>
    [
      Render.job(job),
      ...(job.failure === null ? [] : [job.failure]),
      ...job.outcomes.map(outcome),
      ...job.lines.map(line),
    ].join('\n')
}
