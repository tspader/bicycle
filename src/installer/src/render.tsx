import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import type { Child } from 'hono/jsx'
import type { HtmlEscapedString } from 'hono/utils/html'
import { z } from 'zod'
import { codeToHtml } from 'shiki'
import { Layout, Preview, Warnings } from './views/layout'
import { SignalProvider } from './signal'
import { project, liveMachine, deriveWarnings, type Warning, type AccountSummary } from './config'
import { getConfig, getText, getIdentity, getRootHash, getEncryptionPassword } from './state'
import { listDisks } from './system'
import { type AppContext, parseSignals } from './http'
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

export const patchSidecarInto = async (
  stream: { patchElements: (s: string) => void },
): Promise<void> => {
  const { previewHtml, warnings } = await renderSidecar()
  stream.patchElements((<Preview html={previewHtml} />).toString())
  stream.patchElements((<Warnings items={warnings} />).toString())
}

// --- patch combinators -------------------------------------------------------
// Collapse the repeated `stream(stream => { patchElements...; patchSidecarInto })`
// shape. Falsy fragments are skipped, so conditional patches need no imperative
// branching at the call site.

type Frag = HtmlEscapedString | Promise<HtmlEscapedString> | false | null | undefined

const write = (stream: { patchElements: (s: string) => void }, frags: Frag[]): void => {
  for (const f of frags) if (f) stream.patchElements(f.toString())
}

export const patch = (...frags: Frag[]): Response =>
  ServerSentEventGenerator.stream((stream) => write(stream, frags))

export const patchSidecar = (...frags: Frag[]): Response =>
  ServerSentEventGenerator.stream(async (stream) => {
    write(stream, frags)
    await patchSidecarInto(stream)
  })

// A field-edit route: validate the request signals against `schema`, apply the
// resulting edit to bicycle.yml, then reflect the change in the preview/warnings
// sidecar. Used by every inline autosave that doesn't re-render its own page.
export const editHandler = <T extends z.ZodTypeAny>(
  schema: T,
  apply: (data: z.infer<T>) => void,
) => (c: AppContext): Response => {
  apply(parseSignals(c, schema))
  return patchSidecar()
}

export const renderPage = async (c: AppContext, active: CategoryId | 'install', body: Child, pushUrl?: string) => {
  const { previewHtml, warnings } = await renderSidecar()
  if (!c.get('datastar')) {
    return c.html(
      <SignalProvider value={c.get('signals')}>
        <Layout active={active} previewHtml={previewHtml} warnings={warnings}>{body}</Layout>
      </SignalProvider>,
    )
  }
  return ServerSentEventGenerator.stream((stream) => {
    stream.patchElements((<Preview html={previewHtml} />).toString())
    stream.patchElements((<Warnings items={warnings} />).toString())
    stream.patchElements((<main id="page-content" class="content">{body}</main>).toString())
    stream.patchSignals(JSON.stringify({ activeCat: active }))
    if (pushUrl) stream.executeScript(`history.pushState({}, '', '${pushUrl}')`)
  })
}
