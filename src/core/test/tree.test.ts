import { expect } from 'bun:test'
import type { AppConfig, BicycleConfig } from '@bicycle/shared'
import example from '@bicycle/example/bicycle.yml' with { type: 'text' }
import { Testing } from '@bicycle/core/testing'
import { Tree } from '@bicycle/core/tree'

type SpecCase = {
  name: string
  yml: string
  pick?: (cfg: BicycleConfig) => unknown
  expect: { value: unknown } | { throws: RegExp }
}

const SPEC_CASES: SpecCase[] = [
  {
    name: 'parses catalog and systemd from one document',
    yml: [
      'core:',
      '  hostname: spum-cannon',
      '  timezone: UTC',
      '  kernels: [linux]',
      '  ntp: true',
      'catalog:',
      '  url: "git://192.168.0.211/bikeshop"',
      'systemd:',
      '  enable: [docker.service, sshd.service]',
      '',
    ].join('\n'),
    pick: (cfg) => ({ catalog: cfg.catalog?.url, enable: cfg.systemd?.enable }),
    expect: { value: { catalog: 'git://192.168.0.211/bikeshop', enable: ['docker.service', 'sshd.service'] } },
  },
  {
    name: 'resolves vars into typed fields before validating',
    yml: [
      'vars:',
      '  admin:',
      '    uid: 1000',
      '  media_gid: 1001',
      'users:',
      '  - name: spader',
      '    uid: ${admin.uid}',
      '    sudo: password',
      '    groups: [wheel, media]',
      'groups:',
      '  - name: media',
      '    gid: ${media_gid}',
      '',
    ].join('\n'),
    pick: (cfg) => ({ uid: cfg.users?.[0]?.uid, gid: cfg.groups?.[0]?.gid }),
    expect: { value: { uid: 1000, gid: 1001 } },
  },
  {
    name: 'vars cannot reference other vars',
    yml: ['vars:', '  base: 1000', '  derived: ${base}', ''].join('\n'),
    expect: { throws: /cannot reference/ },
  },
  {
    name: 'an unknown var reference',
    yml: ['users:', '  - name: x', '    uid: ${nope}', '    sudo: none', '    groups: []', ''].join('\n'),
    expect: { throws: /unresolved/ },
  },
  {
    name: 'parses the checked-in example',
    yml: example,
    pick: (cfg) => typeof cfg.core?.hostname,
    expect: { value: 'string' },
  },
  {
    name: 'ingress: parses domain and routes',
    yml: ['ingress:', '  domain: aral.lan', '  routes:', '    recall: 4321', '    steve: 7777', ''].join('\n'),
    pick: (cfg) => cfg.ingress,
    expect: { value: { domain: 'aral.lan', routes: { recall: 4321, steve: 7777 } } },
  },
  {
    name: 'ingress: rejects a route port above 65535',
    yml: ['ingress:', '  domain: aral.lan', '  routes:', '    recall: 70000', ''].join('\n'),
    expect: { throws: /Too big/ },
  },
  {
    name: 'ingress: rejects a route label with uppercase and underscore',
    yml: ['ingress:', '  domain: aral.lan', '  routes:', '    Foo_bar: 80', ''].join('\n'),
    expect: { throws: /host label must be lowercase/ },
  },
  {
    name: 'ingress: rejects a domain with uppercase',
    yml: ['ingress:', '  domain: Aral.lan', ''].join('\n'),
    expect: { throws: /domain must be dot-separated lowercase/ },
  },
]

Testing.each('Tree.bicycle', SPEC_CASES, (it) =>
  Testing.within((w) => {
    Testing.config(w, it.yml)
    const run = () => (it.pick ?? ((cfg) => cfg))(Tree.bicycle(w.host))
    if ('throws' in it.expect) expect(run).toThrow(it.expect.throws)
    else expect(run()).toEqual(it.expect.value)
  }),
)

type AppCase = {
  name: string
  yml: string
  expect: { value: AppConfig } | { throws: RegExp }
}

const APP_CASES: AppCase[] = [
  { name: 'minimal ref', yml: 'ref: abc123\n', expect: { value: { ref: 'abc123' } } },
  {
    name: 'ref, env, host, expose',
    yml: ['ref: abc123', 'env:', '  A: "1"', 'host: recall', 'expose: false', ''].join('\n'),
    expect: { value: { ref: 'abc123', env: { A: '1' }, host: 'recall', expose: false } },
  },
  {
    name: 'rejects an unknown key',
    yml: ['ref: abc123', 'prot: 80', ''].join('\n'),
    expect: { throws: /"code":\s*"unrecognized_keys"[\s\S]*"keys":\s*\[\s*"prot"\s*\]/ },
  },
  { name: 'rejects a missing ref', yml: 'env: {}\n', expect: { throws: /"path":\s*\[\s*"ref"\s*\]/ } },
  {
    name: 'rejects a host label with uppercase and underscore',
    yml: ['ref: abc123', 'host: Foo_bar', ''].join('\n'),
    expect: { throws: /host label must be lowercase/ },
  },
]

Testing.each('Tree.app', APP_CASES, (it) =>
  Testing.within(async (w) => {
    await Testing.runActions(w, [{ do: 'app', name: 'A', config: it.yml }], async () => {})
    const run = () => Tree.app(w.host, 'A')
    if ('throws' in it.expect) expect(run).toThrow(it.expect.throws)
    else expect(run()).toEqual(it.expect.value)
  }),
)
