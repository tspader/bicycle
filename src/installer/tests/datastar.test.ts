import { test, expect } from 'bun:test'
import { z } from 'zod'
import {
  Sig, expr, seq, eq, ne, not, when, get, post,
  on, onInterval, effect, show, text, attr, cls, bind, signals,
} from '../src/datastar'
import { route } from '../src/routes'
import type { AppContext } from '../src/http'

const sig = new Sig<string>('foo')

const EXPR_CASES: Array<{ name: string; code: { code: string }; want: string }> = [
  { name: 'sig ref', code: sig, want: '$foo' },
  { name: 'set literal', code: sig.set('a"b'), want: '$foo = "a\\"b"' },
  { name: 'set from code', code: sig.set(expr`${sig}.trim()`), want: '$foo = $foo.trim()' },
  { name: 'template quotes literals', code: expr`!${sig} || ${"it's"}.includes(${sig})`, want: `!$foo || "it's".includes($foo)` },
  { name: 'seq is a parenthesized comma expression', code: seq(sig.set('x'), get('/a')), want: '($foo = "x", @get("/a"))' },
  { name: 'eq', code: eq(sig, 'bar'), want: '$foo === "bar"' },
  { name: 'ne', code: ne(sig, 'bar'), want: '$foo !== "bar"' },
  { name: 'not', code: not(sig), want: '!($foo)' },
  { name: 'when', code: when(eq(sig, 'x'), post('/b')), want: '($foo === "x") && (@post("/b"))' },
]

for (const c of EXPR_CASES) {
  test(`expr: ${c.name}`, () => {
    expect(c.code.code).toBe(c.want)
  })
}

const ATTR_CASES: Array<{ name: string; props: Record<string, string>; want: Record<string, string> }> = [
  { name: 'on click', props: on('click', get('/a')), want: { 'data-on:click': '@get("/a")' } },
  {
    name: 'on with modifiers',
    props: on('input', post('/a'), { prevent: true, debounceMs: 400 }),
    want: { 'data-on:input__prevent__debounce.400ms': '@post("/a")' },
  },
  { name: 'interval', props: onInterval(get('/t'), 500), want: { 'data-on-interval__duration.500ms': '@get("/t")' } },
  { name: 'effect', props: effect(post('/e')), want: { 'data-effect': '@post("/e")' } },
  { name: 'show', props: show(sig), want: { 'data-show': '$foo' } },
  { name: 'text', props: text(sig), want: { 'data-text': '$foo' } },
  { name: 'attr', props: attr('disabled', not(sig)), want: { 'data-attr:disabled': '!($foo)' } },
  { name: 'class', props: cls('active', eq(sig, 'x')), want: { 'data-class:active': '$foo === "x"' } },
  { name: 'bind', props: bind(sig), want: { 'data-bind': 'foo' } },
]

for (const c of ATTR_CASES) {
  test(`attrs: ${c.name}`, () => {
    expect(c.props).toEqual(c.want)
  })
}

const group = signals(
  {
    mount: z.string().default(''),
    size: z.string().min(1),
    encrypt: z.boolean().default(false),
  },
  'sda_p0_',
)

const ctx = (vars: Record<string, unknown>): AppContext =>
  ({ get: (k: string) => (k === 'signals' ? vars : null) }) as unknown as AppContext

test('group: signal refs carry the prefix', () => {
  expect(group.$.mount.name).toBe('sda_p0_mount')
  expect(group.$.mount.code).toBe('$sda_p0_mount')
})

test('group: seed emits prefixed data-signals JSON', () => {
  expect(group.seed({ mount: '/', size: '1GiB', encrypt: true })).toEqual({
    'data-signals': '{"sda_p0_mount":"/","sda_p0_size":"1GiB","sda_p0_encrypt":true}',
  })
})

test('group: patch prefixes a partial value set', () => {
  expect(group.patch({ mount: '/home' })).toEqual({ sda_p0_mount: '/home' })
})

test('group: read strips prefixes, validates, and applies defaults', () => {
  const data = group.read(ctx({ sda_p0_size: '2GiB', sda_p0_encrypt: true, unrelated: 'x' }))
  expect(data).toEqual({ mount: '', size: '2GiB', encrypt: true })
})

test('group: read rejects invalid signals with a 400', () => {
  expect(() => group.read(ctx({ sda_p0_size: '' }))).toThrow()
})

const lenient = signals({ q: z.string().default(''), repos: z.array(z.string()).default([]) }, 'pkg_')

const errCtx = (): AppContext =>
  ({
    get: (k: string) => (k === 'signals' ? {} : k === 'error' ? 'No datastar object in request' : null),
  }) as unknown as AppContext

test('group: peek falls back to defaults when the request carries no signals', () => {
  expect(lenient.peek(errCtx())).toEqual({ q: '', repos: [] })
})

test('group: peek reads signals when present', () => {
  expect(lenient.peek(ctx({ pkg_q: 'vim', pkg_repos: ['extra'] }))).toEqual({ q: 'vim', repos: ['extra'] })
})

const plain = route('post', '/api/thing')
const withQuery = route('get', '/api/list', {
  name: z.string().min(1),
  idx: z.coerce.number().int().min(0),
  mode: z.enum(['outer', 'append']).default('outer'),
})

test('route: plain url and action', () => {
  expect(plain.url()).toBe('/api/thing')
  expect(plain.action().code).toBe('@post("/api/thing")')
})

test('route: query url encodes params and skips undefined', () => {
  expect(withQuery.url({ name: 'a b&c', idx: 3 })).toBe('/api/list?name=a+b%26c&idx=3')
})

test('route: action wraps the built url', () => {
  expect(withQuery.action({ name: 'x', idx: 0 }).code).toBe('@get("/api/list?name=x&idx=0")')
})

test('route: params parses and coerces the query string', () => {
  const c = { req: { query: () => ({ name: 'x', idx: '4' }) } } as unknown as AppContext
  expect(withQuery.params(c)).toEqual({ name: 'x', idx: 4, mode: 'outer' })
})

test('route: params rejects missing required values', () => {
  const c = { req: { query: () => ({}) } } as unknown as AppContext
  expect(() => withQuery.params(c)).toThrow()
})
