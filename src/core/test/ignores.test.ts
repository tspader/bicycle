import { expect } from 'bun:test'
import type { Diff } from '@bicycle/shared'
import { Ignores } from '@bicycle/core/ignores'
import { Testing } from '@bicycle/core/testing'

type Case = {
  name: string
  before?: string
  tree?: Testing.Actor
  diffs: Diff[]
  expect: { added: boolean[]; text: string; owner?: Testing.Actor }
}

const undeclared = (type: string, id: string): Diff => ({ type, id, field: 'F', expected: null, actual: true })
const drift: Diff = { type: 'file', id: '/a', field: 'mode', expected: '644', actual: '600' }

const cases: Case[] = [
  {
    name: 'an undeclared package goes in the packages section',
    diffs: [undeclared('package', 'A')],
    expect: { added: [true], text: 'packages:\n  - A\n' },
  },
  {
    name: 'an undeclared unit goes in the units section',
    diffs: [undeclared('unit', 'A')],
    expect: { added: [true], text: 'units:\n  - A\n' },
  },
  {
    name: 'a stray file goes in the files section',
    diffs: [undeclared('stray', '/a')],
    expect: { added: [true], text: 'files:\n  - /a\n' },
  },
  {
    name: 'declared drift is a precise rule',
    diffs: [drift],
    expect: { added: [true], text: 'diffs:\n  - {type: file, id: /a, field: mode}\n' },
  },
  {
    name: 'what is already ignored is not added again',
    diffs: [drift, drift],
    expect: { added: [true, false], text: 'diffs:\n  - {type: file, id: /a, field: mode}\n' },
  },
  {
    name: 'comments survive an append',
    before: '# C\nfiles: [/a]\n',
    diffs: [undeclared('package', 'A')],
    expect: { added: [true], text: '# C\nfiles: [/a]\npackages:\n  - A\n' },
  },
  {
    name: 'the file is owned by the owner of the tree',
    tree: Testing.USER,
    diffs: [undeclared('package', 'A')],
    expect: { added: [true], text: 'packages:\n  - A\n', owner: Testing.USER },
  },
]

Testing.each('Ignores.add', cases, (it) =>
  Testing.within((w) => {
    const { paths } = w.host
    if (it.tree) Object.assign(Testing.node(w, paths.etc.root)!, it.tree)
    if (it.before !== undefined) Testing.put(w, paths.etc.ignore, it.before)
    const added = it.diffs.map((d) => Ignores.add(w.host, Ignores.entry(d)))
    expect({ added, text: Testing.text(w, paths.etc.ignore) }).toEqual({ added: it.expect.added, text: it.expect.text })
    if (it.expect.owner) expect(Testing.node(w, paths.etc.ignore)).toMatchObject(it.expect.owner)
  }),
)
