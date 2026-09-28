import { expect } from 'bun:test'
import { Api } from '@bicycle/daemon/api'
import { Testing } from '@bicycle/daemon/testing'

type Call = { method: 'GET' | 'PUT' | 'DELETE'; path: string; body?: string }

type Case = {
  name: string
  recipients: boolean
  key: boolean
  calls: Call[]
  expect: { status: number; body: unknown }
}

const put = (addr: string, body = 'T'): Call => ({ method: 'PUT', path: `/secrets/${addr}`, body })
const get = (addr: string): Call => ({ method: 'GET', path: `/secrets/${addr}` })
const remove = (addr: string): Call => ({ method: 'DELETE', path: `/secrets/${addr}` })
const list: Call = { method: 'GET', path: '/secrets' }

const open = { recipients: true, key: true }

const cases: Case[] = [
  { name: 'no secrets', ...open, calls: [list], expect: { status: 200, body: [] } },
  { name: 'a secret is sealed', ...open, calls: [put('a/b')], expect: { status: 204, body: null } },
  {
    name: 'a sealed secret reads back',
    ...open,
    calls: [put('a/b'), get('a/b')],
    expect: { status: 200, body: { value: 'T' } },
  },
  {
    name: 'sealed secrets are listed',
    ...open,
    calls: [put('b'), put('a/b'), list],
    expect: { status: 200, body: ['a/b', 'b'] },
  },
  { name: 'a secret is forgotten', ...open, calls: [put('a'), remove('a')], expect: { status: 204, body: null } },
  {
    name: 'a forgotten secret is gone',
    ...open,
    calls: [put('a'), remove('a'), list],
    expect: { status: 200, body: [] },
  },
  {
    name: 'reading what is not there',
    ...open,
    calls: [get('a')],
    expect: { status: 404, body: { error: 'no-secret', addr: 'a' } },
  },
  {
    name: 'forgetting what is not there',
    ...open,
    calls: [remove('a')],
    expect: { status: 404, body: { error: 'no-secret', addr: 'a' } },
  },
  {
    name: 'an address with a blank part',
    ...open,
    calls: [put('a/%20/b')],
    expect: { status: 400, body: { error: 'bad-addr', addr: 'a/ /b' } },
  },
  {
    name: 'an empty secret',
    ...open,
    calls: [put('a', '')],
    expect: { status: 400, body: { error: 'empty', addr: 'a' } },
  },
  {
    name: 'sealing with nobody to seal to',
    recipients: false,
    key: true,
    calls: [put('a')],
    expect: { status: 409, body: { error: 'no-recipients', file: '/etc/bicycle/recipients' } },
  },
  {
    name: 'reading with no key',
    recipients: true,
    key: false,
    calls: [put('a'), get('a')],
    expect: { status: 409, body: { error: 'no-key', file: '/etc/bicycle/age.key' } },
  },
]

Testing.each('Api.routes secrets', cases, (it) =>
  Testing.within(async (w) => {
    const { paths } = w.host
    if (it.recipients) Testing.put(w, paths.etc.recipients, `${w.recipient}\n`)
    if (!it.key) w.volume.nodes.delete(paths.key)
    const app = Api.routes(w.host, Testing.bench().queue)
    const replies: Response[] = []
    for (const call of it.calls) replies.push(await app.request(call.path, { method: call.method, body: call.body }))
    const last = replies.at(-1)!
    const text = await last.text()
    expect({ status: last.status, body: text === '' ? null : JSON.parse(text) }).toEqual(it.expect)
  }),
)
