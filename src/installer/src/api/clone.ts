import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { ServerSentEventGenerator } from '@starfederation/datastar-sdk/web'
import { project } from '../config'
import { loadBicycleDoc, type BicycleConfig } from '@bicycle/shared'
import { locateTreeRoot, importTree } from '../import-tree'
import { loadTree } from '../state'
import { env as runtimeEnv } from '../runtime'
import type { AppContext } from '../http'
import { machine, patchSidecarInto } from '../render'

const ImportGitSignals = z.object({
  import_git_url: z.string().min(1, 'repository URL required'),
  import_git_user: z.string().optional().default(''),
  import_git_pass: z.string().optional().default(''),
})

// Validate imported text up front so a bad config fails the import rather than
// silently breaking every later page render.
const loadAndValidate = (text: string): BicycleConfig => loadBicycleDoc(text).resolved

export const git = (c: AppContext) =>
  ServerSentEventGenerator.stream(async (stream) => {
      const announce = (status: string, error: string) =>
        stream.patchSignals(JSON.stringify({ import_status: status, import_error: error }))
      try {
        const sig = ImportGitSignals.parse(c.get('signals') ?? {})
        let url: URL
        try {
          url = new URL(sig.import_git_url.trim())
        } catch {
          throw new Error('invalid URL')
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          throw new Error('only http(s) URLs are supported on the install medium (no SSH keys)')
        }
        if (sig.import_git_user) url.username = encodeURIComponent(sig.import_git_user)
        if (sig.import_git_pass) url.password = encodeURIComponent(sig.import_git_pass)

        const tmp = `/tmp/bicycle-import-${randomUUID()}`
        const safeUrl = sig.import_git_url.trim()
        try {
          const res = Bun.spawnSync(
            ['git', 'clone', '--depth=1', '--single-branch', url.toString(), tmp],
            {
              env: { ...runtimeEnv, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/true' },
              stdout: 'pipe',
              stderr: 'pipe',
            },
          )
          if (res.exitCode !== 0) {
            const raw = new TextDecoder().decode(res.stderr) || 'git clone failed'
            const sanitized = raw
              .replaceAll(url.toString(), safeUrl)
              .replaceAll(sig.import_git_pass || ' ', '***')
            const tail = sanitized.trim().split('\n').slice(-2).join(' ').slice(0, 400)
            throw new Error(tail || 'git clone failed')
          }
          // Read the entire tree into memory, then validate it parses. The clone
          // is deleted immediately — nothing references it past this point.
          const root = locateTreeRoot(tmp)
          const tree = importTree(root)
          project(loadAndValidate(tree.text), machine)
          loadTree(tree)
        } finally {
          try { Bun.spawnSync(['rm', '-rf', tmp]) } catch {}
        }
        announce(`Imported from ${safeUrl}`, '')
        stream.patchSignals(JSON.stringify({ import_git_url: '', import_git_user: '', import_git_pass: '' }))
        await patchSidecarInto(stream)
      } catch (e) {
        announce('', (e as Error).message || 'import failed')
      }
    })
