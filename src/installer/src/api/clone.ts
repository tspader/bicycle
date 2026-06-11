import { randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { project } from '../config'
import { loadBicycleDoc, type BicycleConfig } from '@bicycle/shared'
import { locateTreeRoot, importTree } from '../import-tree'
import { loadTree } from '../state'
import { env as runtimeEnv } from '../runtime'
import { type AppContext, type Stream, sse } from '@bicycle/datastar'
import { gitImportSignals, importStatusSignals } from '../views/import'
import { machine, patchSidecarInto } from '../render'

// Validate imported text up front so a bad config fails the import rather than
// silently breaking every later page render.
const loadAndValidate = (text: string): BicycleConfig => loadBicycleDoc(text).resolved

export const git = (c: AppContext) =>
  sse(async (stream: Stream) => {
    const announce = (status: string, error: string) =>
      stream.signals(importStatusSignals.patch({ status, error }))
    try {
      const sig = gitImportSignals.read(c)
      let url: URL
      try {
        url = new URL(sig.git_url)
      } catch {
        throw new Error('invalid URL')
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('only http(s) URLs are supported on the install medium (no SSH keys)')
      }
      if (sig.git_user) url.username = encodeURIComponent(sig.git_user)
      if (sig.git_pass) url.password = encodeURIComponent(sig.git_pass)

      const tmp = `/tmp/bicycle-import-${randomUUID()}`
      const safeUrl = sig.git_url
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
            .replaceAll(sig.git_pass || ' ', '***')
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
      stream.signals(gitImportSignals.patch({ git_url: '', git_user: '', git_pass: '' }))
      await patchSidecarInto(stream)
    } catch (e) {
      const message = e instanceof HTTPException ? e.message : (e as Error).message
      announce('', message || 'import failed')
    }
  })
