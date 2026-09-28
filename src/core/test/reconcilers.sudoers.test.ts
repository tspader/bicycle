import { expect } from 'bun:test'
import type { SudoMode } from '@bicycle/shared'
import { Sudoers } from '@bicycle/core/reconcilers/sudoers'
import { Testing } from '@bicycle/core/testing'

type RuleCase = {
  name: string
  users: { name: string; sudo: SudoMode }[]
  expect: string[]
}

const RULE_CASES: RuleCase[] = [
  { name: 'none yields no rule', users: [{ name: 'a', sudo: 'none' }], expect: [] },
  { name: 'password yields a full rule', users: [{ name: 'a', sudo: 'password' }], expect: ['a ALL=(ALL:ALL) ALL'] },
  {
    name: 'passwordless yields NOPASSWD',
    users: [{ name: 'a', sudo: 'passwordless' }],
    expect: ['a ALL=(ALL:ALL) NOPASSWD: ALL'],
  },
  {
    name: 'keeps only sudoers, preserving order',
    users: [
      { name: 'a', sudo: 'password' },
      { name: 'b', sudo: 'none' },
      { name: 'c', sudo: 'passwordless' },
    ],
    expect: ['a ALL=(ALL:ALL) ALL', 'c ALL=(ALL:ALL) NOPASSWD: ALL'],
  },
]

Testing.each('Sudoers.rulesFor', RULE_CASES, (it) => {
  expect(Sudoers.rulesFor(it.users)).toEqual(it.expect)
})

const DROP_IN = 'etc/sudoers.d/bicycle'

const CASES: Testing.ReconcilerCase[] = [
  {
    name: 'no bicycle.yml: no-op',
    actions: [{ do: 'sweep' }],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: 'no sudo users and no drop-in is clean',
    actions: [{ do: 'config', config: { users: [{ name: 'bob', sudo: 'none', groups: [] }] } }, { do: 'sweep' }],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: 'no sudo users: removes a stale drop-in',
    actions: [
      { do: 'host', rel: DROP_IN, contents: 'stale\n' },
      { do: 'config', config: { users: [{ name: 'bob', sudo: 'none', groups: [] }] } },
      { do: 'sweep' },
    ],
    fs: [{ path: DROP_IN, absent: true }],
    plan: [],
  },
  {
    name: 'plan: stale drop-in with no sudo users yields an exists diff',
    actions: [
      { do: 'host', rel: DROP_IN, contents: 'stale\n' },
      { do: 'config', config: { users: [{ name: 'bob', sudo: 'none', groups: [] }] } },
    ],
    plan: [{ type: 'file', id: DROP_IN, field: 'exists', expected: false, actual: true }],
  },
  {
    name: 'plan: sudo user with no drop-in yields a content diff',
    actions: [{ do: 'config', config: { users: [{ name: 'alice', sudo: 'password', groups: [] }] } }],
    plan: [
      {
        type: 'file',
        id: DROP_IN,
        field: 'content',
        expected: 'b36f8829084b847e622ef0d22aa32ba8b47a43ef28148f378b3963a34579a5f1',
        actual: null,
      },
    ],
  },
  {
    name: 'visudo-rejected update leaves the last valid drop-in',
    actions: [
      { do: 'config', config: { users: [{ name: 'alice', sudo: 'password', groups: [] }] } },
      { do: 'sweep' },
      { do: 'config', config: { users: [{ name: 'a b', sudo: 'password', groups: [] }] } },
      { do: 'sweep' },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents: '# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) ALL\n',
      },
      { path: `${DROP_IN}.tmp`, absent: true },
    ],
    errors: ['sudoers: visudo validation failed; not applying'],
    plan: [{ type: 'file', id: DROP_IN, field: 'content' }],
  },
  {
    name: 'a first drop-in that visudo rejects is never put in place',
    actions: [{ do: 'config', config: { users: [{ name: 'a b', sudo: 'password', groups: [] }] } }, { do: 'sweep' }],
    fs: [
      { path: DROP_IN, absent: true },
      { path: `${DROP_IN}.tmp`, absent: true },
    ],
    errors: ['sudoers: visudo validation failed; not applying'],
  },
  {
    name: 'what visudo is shown is not yet under the name that is read',
    actions: [
      { do: 'fault', program: 'visudo', args: [], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: { users: [{ name: 'alice', sudo: 'password', groups: [] }] } },
      { do: 'sweep' },
    ],
    fs: [{ path: DROP_IN, absent: true }],
    calls: ['visudo -cf /etc/sudoers.d/bicycle.tmp'],
  },
  {
    name: 'repairs a manually edited drop-in',
    actions: [
      { do: 'config', config: { users: [{ name: 'alice', sudo: 'password', groups: [] }] } },
      { do: 'sweep' },
      { do: 'chmodHost', rel: DROP_IN, mode: 0o640 },
      {
        do: 'host',
        rel: DROP_IN,
        contents: '# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) NOPASSWD: ALL\n',
      },
      { do: 'sweep' },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents: '# Managed by Bicycle. Do not edit.\nalice ALL=(ALL:ALL) ALL\n',
      },
    ],
    plan: [],
  },
  {
    name: 'writes a validated drop-in for sudo users',
    actions: [
      {
        do: 'config',
        config: {
          users: [
            { name: 'alice', sudo: 'password', groups: ['wheel'] },
            { name: 'deploy', sudo: 'passwordless', groups: [] },
            { name: 'bob', sudo: 'none', groups: [] },
          ],
        },
      },
      { do: 'sweep' },
    ],
    fs: [
      {
        path: DROP_IN,
        mode: 0o440,
        contents:
          '# Managed by Bicycle. Do not edit.\n' + 'alice ALL=(ALL:ALL) ALL\n' + 'deploy ALL=(ALL:ALL) NOPASSWD: ALL\n',
      },
    ],
    plan: [],
  },
  {
    name: 'an unchanged config does not rewrite',
    actions: [
      { do: 'config', config: { users: [{ name: 'alice', sudo: 'password', groups: [] }] } },
      { do: 'sweep' },
      { do: 'backdate', rel: DROP_IN },
      { do: 'sweep' },
    ],
    fs: [{ path: DROP_IN, stale: true }],
  },
]

Testing.reconciles('Sudoers.all', Sudoers, CASES)
