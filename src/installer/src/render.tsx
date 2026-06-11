import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import type { Child } from 'hono/jsx'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { z } from 'zod'
import { codeToHtml } from 'shiki'
import { Layout, Preview, Warnings, ui } from './views/layout'
import { project, liveMachine, deriveWarnings, type Warning, type AccountSummary } from './config'
import { getConfig, getText, getIdentity, getRootHash, getEncryptionPassword } from './state'
import { listDisks } from './system'
import type { AppContext } from './http'
import type { Json, SignalGroup } from './datastar'
import type { CategoryId } from './ui-state'
import { type BicycleConfig } from '@bicycle/shared'

// The live machine probe is a process-wide singleton: it reflects the host the
// installer runs on, not anything request-scoped.
export const machine = liveMachine()

// Parse the bicycle.yml text into the resolved Bicycle config and its throwaway
// archinstall projection. Either parse or projection can fail on a config the
// user is mid-edit (e.g. inconsistent encryption) — callers surface `error`.
export type ConfigState = {
  bike: BicycleConfig
  archinstall: ReturnType<typeof project> | null
  error: string | null
}
export const configState = (): ConfigState => {
  let bike: BicycleConfig
  try {
    bike = getConfig()
  } catch (e) {
    return { bike: {}, archinstall: null, error: (e as Error).message }
  }
  try {
    return { bike, archinstall: project(bike, machine), error: null }
  } catch (e) {
    return { bike, archinstall: null, error: (e as Error).message }
  }
}

const accounts = (bike: BicycleConfig): AccountSummary[] =>
  (bike.users ?? []).map((u) => ({ name: u.name, sudo: u.sudo, hasPassword: !!u.password }))

export const preflightCtx = (bike: BicycleConfig) => ({
  identity: getIdentity(),
  rootSet: !!getRootHash(),
  encryptionSet: !!getEncryptionPassword(),
  accounts: accounts(bike),
})

export const flatPackages = (bike: BicycleConfig): string[] =>
  Object.values(bike.packages ?? {}).flat()

const renderPreviewHtml = async (): Promise<string> => {
  const text = getText().trim() || '# empty config'
  try {
    return await codeToHtml(text, { lang: 'yaml', theme: 'github-dark-default' })
  } catch (e) {
    return codeToHtml(`# preview unavailable\n# ${(e as Error).message}`, { lang: 'yaml', theme: 'github-dark-default' })
  }
}

const renderSidecar = async () => {
  const [previewHtml, disks] = await Promise.all([renderPreviewHtml(), listDisks()])
  const { bike, archinstall, error } = configState()
  const warnings: Warning[] = archinstall
    ? deriveWarnings(archinstall, disks, preflightCtx(bike))
    : [{ severity: 'error', message: `Config error: ${error}`, category: 'import' }]
  return { previewHtml, warnings }
}

// --- SSE facade ----------------------------------------------------------------
// All Datastar SSE responses go through `sse`. The facade renders JSX directly,
// takes signal patches as typed objects, and skips falsy fragments so
// conditional patches need no imperative branching at the call site.

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

export const patchSidecarInto = async (stream: Stream): Promise<void> => {
  const { previewHtml, warnings } = await renderSidecar()
  stream.html(<Preview html={previewHtml} />)
  stream.html(<Warnings items={warnings} />)
}

export const patch = (...frags: Frag[]): Response =>
  sse((stream) => {
    for (const f of frags) stream.html(f)
  })

export const patchSidecar = (...frags: Frag[]): Response =>
  sse(async (stream) => {
    for (const f of frags) stream.html(f)
    await patchSidecarInto(stream)
  })

// A field-edit route: validate the request signals against the view's signal
// group, apply the resulting edit to bicycle.yml, then reflect the change in
// the preview/warnings sidecar. Used by every inline autosave that doesn't
// re-render its own page.
export const editHandler = <S extends z.ZodRawShape>(
  group: SignalGroup<S>,
  apply: (data: z.output<z.ZodObject<S>>) => void,
) => (c: AppContext): Response => {
  apply(group.read(c))
  return patchSidecar()
}

export const renderPage = async (c: AppContext, active: CategoryId | 'install', body: Child, pushUrl?: string) => {
  const { previewHtml, warnings } = await renderSidecar()
  if (!c.get('datastar')) {
    return c.html(
      <Layout active={active} previewHtml={previewHtml} warnings={warnings}>{body}</Layout>,
    )
  }
  return sse((stream) => {
    stream.html(<Preview html={previewHtml} />)
    stream.html(<Warnings items={warnings} />)
    stream.html(<main id="page-content" class="content">{body}</main>)
    stream.signals(ui.patch({ active_cat: active }))
    if (pushUrl) stream.script(`history.pushState({}, '', ${JSON.stringify(pushUrl)})`)
  })
}
