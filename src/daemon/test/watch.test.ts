import { expect } from 'bun:test'
import { Paths } from '@bicycle/core/paths'
import { Reconcilers } from '@bicycle/core/reconcilers'
import type { Jobs } from '@bicycle/daemon/jobs'
import { Testing } from '@bicycle/daemon/testing'
import { Watch } from '@bicycle/daemon/watch'

type Case = { name: string; file: string; expect: Jobs.Work | null }

const paths = Paths.of({ etc: '/e', state: '/s', run: '/r', root: '/h', key: '/k', scanner: 'S' })

const files: Jobs.Work = { kind: 'reconcile', only: ['files'] }
const secrets: Jobs.Work = { kind: 'reconcile', only: ['files', 'app'] }

const cases: Case[] = [
  {
    name: 'the spec is everything',
    file: '/e/bicycle.yml',
    expect: { kind: 'reconcile', only: [...Reconcilers.ORDER] },
  },
  { name: 'a file', file: '/e/files/etc/a', expect: files },
  { name: 'a descriptor', file: '/e/files/etc/a.bicycle', expect: files },
  { name: 'a secret feeds files and apps', file: '/e/secrets/a/b.age', expect: secrets },
  { name: 'the secrets tree itself', file: '/e/secrets', expect: secrets },
  { name: 'an app config is that app', file: '/e/apps/A/config.yml', expect: { kind: 'app', name: 'A' } },
  { name: 'an app override is that app', file: '/e/apps/A/compose.yml', expect: { kind: 'app', name: 'A' } },
  { name: 'anything else under an app', file: '/e/apps/A/notes.md', expect: null },
  { name: 'a file named like an input beside the apps', file: '/e/apps/config.yml', expect: null },
  { name: 'the ignore file', file: '/e/ignore.yml', expect: null },
  { name: 'the key', file: '/e/age.key', expect: null },
  { name: 'the repository', file: '/e/.git/index', expect: null },
  { name: 'a tree named like the files tree', file: '/e/files2/a', expect: null },
]

Testing.each('Watch.classify', cases, (it) => {
  expect(Watch.classify(paths, it.file)).toEqual(it.expect)
})
