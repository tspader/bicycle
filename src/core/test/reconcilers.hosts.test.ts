import { expect } from 'bun:test'
import { Hosts } from '@bicycle/core/reconcilers/hosts'
import { Testing } from '@bicycle/core/testing'

type BlockCase = {
  name: string
  names: string[]
  want: string
}

const BLOCK_CASES: BlockCase[] = [
  { name: 'no names is no block', names: [], want: '' },
  {
    name: 'one name',
    names: ['a.aral.lan'],
    want: '# bicycle\n127.0.0.1 a.aral.lan\n# /bicycle\n',
  },
  {
    name: 'many names are sorted',
    names: ['b.aral.lan', 'c.aral.lan', 'a.aral.lan'],
    want:
      '# bicycle\n' + '127.0.0.1 a.aral.lan\n' + '127.0.0.1 b.aral.lan\n' + '127.0.0.1 c.aral.lan\n' + '# /bicycle\n',
  },
]

Testing.each('Hosts.block', BLOCK_CASES, (c) => {
  expect(Hosts.block(c.names)).toBe(c.want)
})

const A = '# bicycle\n127.0.0.1 a.aral.lan\n# /bicycle\n'
const B = '# bicycle\n127.0.0.1 b.aral.lan\n# /bicycle\n'
const LOCALHOST = '127.0.0.1 localhost\n'
const LOCALHOST6 = '::1 localhost\n'

type SpliceCase = {
  name: string
  existing: string
  block: string
  want: string
}

const SPLICE_CASES: SpliceCase[] = [
  { name: 'empty file becomes the block', existing: '', block: A, want: A },
  { name: 'empty file with no block stays empty', existing: '', block: '', want: '' },
  {
    name: 'missing trailing newline gets one before the block',
    existing: '127.0.0.1 localhost',
    block: A,
    want: LOCALHOST + A,
  },
  {
    name: 'trailing newline is not doubled',
    existing: LOCALHOST,
    block: A,
    want: LOCALHOST + A,
  },
  {
    name: 'no block and nothing to add leaves the file untouched',
    existing: '127.0.0.1 localhost',
    block: '',
    want: '127.0.0.1 localhost',
  },
  {
    name: 'block in the middle is replaced in place',
    existing: LOCALHOST + A + LOCALHOST6,
    block: B,
    want: LOCALHOST + B + LOCALHOST6,
  },
  {
    name: 'block at the start is replaced in place',
    existing: A + LOCALHOST6,
    block: B,
    want: B + LOCALHOST6,
  },
  {
    name: 'current block is unchanged',
    existing: LOCALHOST + A,
    block: A,
    want: LOCALHOST + A,
  },
  {
    name: 'empty block removes an existing block',
    existing: LOCALHOST + A + LOCALHOST6,
    block: '',
    want: LOCALHOST + LOCALHOST6,
  },
  {
    name: 'empty block removes a trailing block',
    existing: LOCALHOST + A,
    block: '',
    want: LOCALHOST,
  },
  {
    name: 'text after the block without a trailing newline is kept as is',
    existing: A + '::1 localhost',
    block: B,
    want: B + '::1 localhost',
  },
  {
    name: 'blank line before the block is kept',
    existing: LOCALHOST + '\n' + A,
    block: B,
    want: LOCALHOST + '\n' + B,
  },
  {
    name: 'open marker without close swallows to end of file',
    existing: LOCALHOST + '# bicycle\n127.0.0.1 a.aral.lan\n',
    block: B,
    want: LOCALHOST + B,
  },
  {
    name: 'open marker without close truncated mid-line is healed',
    existing: LOCALHOST + '# bicycle\n127.0.0.1 a.ara',
    block: B,
    want: LOCALHOST + B,
  },
  {
    name: 'open marker without close is removed by an empty block',
    existing: LOCALHOST + '# bicycle\n127.0.0.1 a.aral.lan\n',
    block: '',
    want: LOCALHOST,
  },
]

Testing.each('Hosts.splice', SPLICE_CASES, (c) => {
  const got = Hosts.splice(c.existing, c.block)
  expect(got).toBe(c.want)
  expect(Hosts.splice(got, c.block)).toBe(got)
})
