import { expect } from 'bun:test'
import { Paths } from '@bicycle/core/paths'
import { Testing } from '@bicycle/core/testing'

type Case = { name: string; pick: (paths: Paths) => string; expect: string }

const paths = Paths.of({ etc: '/e', state: '/s', run: '/r', root: '/h', key: '/k', scanner: 'S' })

const cases: Case[] = [
  { name: 'the machine spec', pick: (p) => p.etc.bicycle, expect: '/e/bicycle.yml' },
  { name: 'the ignore file', pick: (p) => p.etc.ignore, expect: '/e/ignore.yml' },
  { name: 'the recipients', pick: (p) => p.etc.recipients, expect: '/e/recipients' },
  { name: 'the files tree', pick: (p) => p.etc.files, expect: '/e/files' },
  { name: 'the secrets tree', pick: (p) => p.etc.secrets, expect: '/e/secrets' },
  { name: 'an app config', pick: (p) => p.etc.app('A').config, expect: '/e/apps/A/config.yml' },
  { name: 'an app override', pick: (p) => p.etc.app('A').compose, expect: '/e/apps/A/compose.yml' },
  { name: 'the written files', pick: (p) => p.state.written, expect: '/s/files-manifest.json' },
  { name: 'the allocated ports', pick: (p) => p.state.ports, expect: '/s/ports.json' },
  { name: 'a deployed compose file', pick: (p) => p.state.app('A').compose, expect: '/s/apps/A/compose.yml' },
  { name: 'a generated override', pick: (p) => p.state.app('A').override, expect: '/s/apps/A/override.yml' },
  { name: 'an app mount', pick: (p) => p.state.app('A').mount('B', 'C'), expect: '/s/apps/A/B/C' },
  { name: 'a catalog checkout', pick: (p) => p.state.catalog('A', 'R').root, expect: '/s/cache/catalog/A/R' },
  {
    name: 'a catalog compose file',
    pick: (p) => p.state.catalog('A', 'R').compose,
    expect: '/s/cache/catalog/A/R/A/compose.yml',
  },
  {
    name: 'a catalog manifest',
    pick: (p) => p.state.catalog('A', 'R').manifest,
    expect: '/s/cache/catalog/A/R/A/bicycle.yml',
  },
  { name: 'the Caddyfile', pick: (p) => p.state.ingress.caddyfile, expect: '/s/ingress/caddy/Caddyfile' },
  { name: 'a scan record', pick: (p) => p.state.scan('D'), expect: '/s/scan/D.json' },
  { name: 'a detector cache', pick: (p) => p.state.detector('D'), expect: '/s/cache/detect/D' },
  { name: 'the prunes handed to detectors', pick: (p) => p.run.prunes, expect: '/r/scan-prunes.txt' },
  { name: 'the claims handed to detectors', pick: (p) => p.run.claims, expect: '/r/claims.txt' },
  { name: 'a path on the host', pick: (p) => p.host('etc/A'), expect: '/h/etc/A' },
]

Testing.each('Paths.of', cases, (it) => {
  expect(it.pick(paths)).toBe(it.expect)
})
