import { expect } from 'bun:test'
import { Interpolate } from '@bicycle/core/interpolate'
import { Testing } from '@bicycle/core/testing'

type Case = {
  name: string
  text: string
  vars?: unknown
  secrets?: Record<string, string>
  expect: { text: string } | { throws: RegExp }
}

const cases: Case[] = [
  { name: 'text without references is unchanged', text: 'A', expect: { text: 'A' } },
  { name: 'a secret', text: 'A=${secret:a/b}', secrets: { 'a/b': 'S' }, expect: { text: 'A=S' } },
  {
    name: 'several secrets, one twice',
    text: 'A=${secret:a};B=${secret:b};C=${secret:a}',
    secrets: { a: 'S', b: 'T' },
    expect: { text: 'A=S;B=T;C=S' },
  },
  { name: 'a missing secret', text: 'A=${secret:a}', expect: { throws: /no secret/ } },
  { name: 'a var', text: 'A=${a}', vars: { a: 1 }, expect: { text: 'A=1' } },
  { name: 'a dotted var', text: 'A=${a.b}', vars: { a: { b: 1 } }, expect: { text: 'A=1' } },
  { name: 'an unknown var', text: 'A=${a}', expect: { throws: /unresolved/ } },
  { name: 'a var that is an object', text: 'A=${a}', vars: { a: { b: 1 } }, expect: { throws: /object/ } },
  { name: 'a reference that is not a path', text: 'A=${a b}', expect: { throws: /invalid interpolation/ } },
  {
    name: 'a var and a secret in one string',
    text: 'https://${a}.lan/?k=${secret:b}&z',
    vars: { a: 'H' },
    secrets: { b: 'S' },
    expect: { text: 'https://H.lan/?k=S&z' },
  },
]

Testing.each('Interpolate.run', cases, async (it) => {
  const secret = async (addr: string): Promise<string> => {
    const found = it.secrets?.[addr]
    if (found === undefined) throw new Error(`no secret ${addr}`)
    return found
  }
  const run = Interpolate.run(it.text, it.vars ?? {}, secret)
  if ('throws' in it.expect) await expect(run).rejects.toThrow(it.expect.throws)
  else expect(await run).toBe(it.expect.text)
})
