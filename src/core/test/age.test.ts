import { expect } from 'bun:test'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { Age, type Fail } from '@bicycle/core/age'
import { Testing } from '@bicycle/core/testing'

type Line = { identity: 'A' | 'B' } | { text: string }

type Case = {
  name: string
  key: Line[] | null
  expect: { value: string } | { error: Fail.Kind }
}

const A: Line = { identity: 'A' }
const B: Line = { identity: 'B' }

const KEY = '/K'
const SEALED = '/S'

const cases: Case[] = [
  { name: 'decrypts with the identity it was sealed to', key: [A], expect: { value: 'T' } },
  {
    name: 'skips blank lines and comments in the key',
    key: [{ text: '# C' }, { text: '' }, A],
    expect: { value: 'T' },
  },
  { name: 'tries every identity in the key', key: [B, A], expect: { value: 'T' } },
  { name: 'another identity does not decrypt', key: [B], expect: { error: 'undecryptable' } },
  { name: 'a key of comments has no identity', key: [{ text: '# C' }], expect: { error: 'no-key' } },
  { name: 'a missing key has no identity', key: null, expect: { error: 'no-key' } },
]

Testing.each('Age.text', cases, (it) =>
  Testing.within(async (w) => {
    const identities = { A: await generateIdentity(), B: await generateIdentity() }
    const lines = (it.key ?? []).map((line) => ('text' in line ? line.text : identities[line.identity]))
    if (it.key !== null) Testing.put(w, KEY, lines.join('\n') + '\n')
    Testing.put(
      w,
      SEALED,
      await Age.encrypt(new TextEncoder().encode('T'), [await identityToRecipient(identities.A)]),
    )
    expect(await Testing.outcome(() => Age.text(w.host.disk, KEY, SEALED))).toEqual(it.expect)
  }),
)
