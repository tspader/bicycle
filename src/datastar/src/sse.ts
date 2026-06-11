import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { Json } from './expression'

// The facade renders JSX directly, takes signal patches as typed objects, and
// skips falsy fragments so conditional patches need no imperative branching at
// the call site.

export type Frag = HtmlEscapedString | Promise<HtmlEscapedString> | false | null | undefined

export type PatchOptions = {
  selector?: string
  mode?: 'outer' | 'inner' | 'replace' | 'prepend' | 'append' | 'before' | 'after' | 'remove'
}

export type Stream = {
  html: (frag: Frag, options?: PatchOptions) => void
  signals: (patch: Record<string, Json>) => void
  script: (code: string) => void
}

export const sse = (fn: (stream: Stream) => void | Promise<void>): Response =>
  ServerSentEventGenerator.stream(async (raw) => {
    await fn({
      html: (frag, options) => {
        if (frag) raw.patchElements(frag.toString(), options)
      },
      signals: (patch) => raw.patchSignals(JSON.stringify(patch)),
      script: (code) => raw.executeScript(code),
    })
  })

export const patch = (...frags: Frag[]): Response =>
  sse((stream) => {
    for (const f of frags) stream.html(f)
  })
