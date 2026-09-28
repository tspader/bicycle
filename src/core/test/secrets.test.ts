import { expect } from 'bun:test'
import path from 'path'
import { Secrets, type Fail } from '@bicycle/core/secrets'
import { Testing } from '@bicycle/core/testing'

type Step =
  | { do: 'tree'; owner: Testing.Actor }
  | { do: 'recipients'; text: string }
  | { do: 'write'; addr: string; clear: string }
  | { do: 'read'; addr: string }
  | { do: 'remove'; addr: string }

type Expect = {
  error?: Fail.Kind
  read?: string[]
  list?: string[]
  files?: { rel: string; mode: number; owner?: Testing.Actor }[]
}

type Case = { name: string; steps: Step[]; expect: Expect }

const own: Step = { do: 'recipients', text: 'OWN' }
const write = (addr: string, clear = 'T'): Step => ({ do: 'write', addr, clear })
const read = (addr: string): Step => ({ do: 'read', addr })
const remove = (addr: string): Step => ({ do: 'remove', addr })

const cases: Case[] = [
  { name: 'nothing written lists nothing', steps: [], expect: { list: [] } },
  { name: 'a written secret reads back', steps: [own, write('A'), read('A')], expect: { read: ['T'], list: ['A'] } },
  {
    name: 'an address nests under directories',
    steps: [own, write('A/B'), read('A/B')],
    expect: { read: ['T'], list: ['A/B'], files: [{ rel: 'A/B.age', mode: 0o600 }] },
  },
  {
    name: 'a secret and the directories made for it are owned by the owner of the tree',
    steps: [{ do: 'tree', owner: Testing.USER }, own, write('A/B')],
    expect: {
      files: [
        { rel: 'A', mode: 0o755, owner: Testing.USER },
        { rel: 'A/B.age', mode: 0o600, owner: Testing.USER },
      ],
    },
  },
  {
    name: 'the list is sorted',
    steps: [own, write('B'), write('A/B'), write('A/A')],
    expect: { list: ['A/A', 'A/B', 'B'] },
  },
  {
    name: 'a second write replaces the first',
    steps: [own, write('A'), write('A', 'U'), read('A')],
    expect: { read: ['U'] },
  },
  { name: 'a removed secret is gone', steps: [own, write('A'), remove('A')], expect: { list: [] } },
  { name: 'an empty secret is refused', steps: [own, write('A', '')], expect: { error: 'empty', list: [] } },
  { name: 'no recipients file is refused', steps: [write('A')], expect: { error: 'no-recipients', list: [] } },
  {
    name: 'a recipients file of comments is refused',
    steps: [{ do: 'recipients', text: '# C\n\n' }, write('A')],
    expect: { error: 'no-recipients', list: [] },
  },
  { name: 'reading what is not there', steps: [own, read('A')], expect: { error: 'no-secret' } },
  { name: 'removing what is not there', steps: [own, remove('A')], expect: { error: 'no-secret' } },
  { name: 'an address that climbs out', steps: [own, write('../A')], expect: { error: 'bad-addr', list: [] } },
  { name: 'an absolute address', steps: [own, read('/A')], expect: { error: 'bad-addr' } },
  { name: 'an empty address', steps: [own, read('')], expect: { error: 'bad-addr' } },
  { name: 'an address with a blank part', steps: [own, read('A/ /B')], expect: { error: 'bad-addr' } },
]

Testing.each('Secrets', cases, (it) =>
  Testing.within(async (w) => {
    const { paths } = w.host
    const seen: string[] = []
    const run = async (step: Step): Promise<void> => {
      switch (step.do) {
        case 'tree':
          Object.assign(Testing.node(w, paths.etc.root)!, step.owner)
          return
        case 'recipients':
          Testing.put(w, paths.etc.recipients, step.text.replace('OWN', w.recipient))
          return
        case 'write':
          await Secrets.write(w.host, step.addr, new TextEncoder().encode(step.clear))
          return
        case 'read':
          seen.push(await Secrets.read(w.host, step.addr))
          return
        case 'remove':
          Secrets.remove(w.host, step.addr)
          return
      }
    }
    const outcome = await Testing.outcome(async () => {
      for (const step of it.steps) await run(step)
    })
    expect('error' in outcome ? outcome.error : undefined).toBe(it.expect.error)
    if (it.expect.read) expect(seen).toEqual(it.expect.read)
    if (it.expect.list) expect(Secrets.list(w.host)).toEqual(it.expect.list)
    for (const { rel, ...file } of it.expect.files ?? []) {
      expect(Testing.node(w, path.join(paths.etc.secrets, rel))).toMatchObject({ mode: file.mode, ...file.owner })
    }
  }),
)
