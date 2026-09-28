import { z } from 'zod'
import { DiffSchema, type Detector, type Diff } from '@bicycle/shared'
import type { Clock } from '@bicycle/core/clock'
import type { Host } from '@bicycle/core/host'
import { Log } from '@bicycle/core/log'

export namespace Exec {
  const Found = DiffSchema.extend({ t: z.literal('diff') }).strict()

  export const Progress = z
    .object({
      t: z.literal('progress'),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().optional(),
      msg: z.string().optional(),
    })
    .strict()
  export type Progress = z.infer<typeof Progress>

  const Logged = z
    .object({
      t: z.literal('log'),
      level: Log.Level,
      msg: z.string(),
    })
    .strict()

  const Line = z.discriminatedUnion('t', [Found, Progress, Logged])

  const Tagged = z.looseObject({ t: z.string() })

  export type Run = {
    env: Record<string, string>
    timeout: number
    grace: number
    progress: (p: Progress) => void
  }

  export type Result = {
    diffs: Diff[]
    malformed: number
  }

  export const TIMEOUT = 60 * 60 * 1000
  export const GRACE = 5_000

  const known = new Set(['diff', 'progress', 'log'])

  function json(line: string): unknown {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  }

  export async function run(host: Host, detector: Detector, run: Run): Promise<Result> {
    const proc = host.spawn(detector.exec, run.env)
    const state = { expired: false, drained: true, malformed: 0 }
    const diffs: Diff[] = []

    const kills: Clock.Cancel[] = []
    kills.push(
      host.clock.after(run.timeout, () => {
        state.expired = true
        proc.kill('SIGTERM')
        kills.push(host.clock.after(run.grace, () => proc.kill('SIGKILL')))
      }),
    )

    const handle = (text: string) => {
      if (text.trim() === '') return
      const raw = json(text)
      const tagged = Tagged.safeParse(raw)
      if (raw === undefined) {
        state.malformed += 1
        return
      }
      if (!tagged.success || !known.has(tagged.data.t)) return
      const line = Line.safeParse(raw)
      if (!line.success) {
        state.malformed += 1
        return
      }
      switch (line.data.t) {
        case 'diff': {
          const { t, ...diff } = line.data
          diffs.push(diff)
          return
        }
        case 'progress':
          run.progress(line.data)
          return
        case 'log':
          host.log[line.data.level]({ detector: detector.name }, line.data.msg)
          return
      }
    }

    const stderr = new Response(proc.stderr).text()
    const reader = proc.stdout.getReader()
    const consumed = (async () => {
      const decoder = new TextDecoder()
      const state = { buf: '' }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const parts = (state.buf + decoder.decode(value, { stream: true })).split('\n')
        state.buf = parts.pop()!
        for (const part of parts) handle(part)
      }
      handle(state.buf + decoder.decode())
    })().catch(() => {})

    const code = await proc.exited
    for (const cancel of kills) cancel()

    const drain = host.clock.after(run.grace, () => {
      state.drained = false
      void reader.cancel()
    })
    await consumed
    drain()
    if (!state.drained) {
      host.log.warn({ detector: detector.name }, 'detector left stdout open; output truncated')
    }

    if (code !== 0 || state.expired) {
      const silent = Promise.withResolvers<string>()
      const waited = host.clock.after(run.grace, () => silent.resolve(''))
      const text = await Promise.race([stderr, silent.promise])
      waited()
      const tail = text.trim().split('\n').slice(-5).join('\n')
      const why = state.expired ? `timed out after ${run.timeout}ms` : `exited ${code}`
      throw new Error(`detector ${detector.name} ${why}${tail ? `: ${tail}` : ''}`)
    }
    if (state.malformed > 0) {
      host.log.warn({ detector: detector.name, malformed: state.malformed }, 'detector emitted malformed lines')
    }
    return { diffs, malformed: state.malformed }
  }
}
