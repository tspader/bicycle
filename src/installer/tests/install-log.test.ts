import { test, expect } from 'bun:test'
import { collapseTerminal } from '../src/views/install'

test('collapses \\r progress redraws to the latest frame', () => {
  expect(collapseTerminal('foo\rbar\n')).toBe('bar\n')
  expect(collapseTerminal('a\rb\rc\nx')).toBe('c\nx')
})

test('strips ANSI escape sequences', () => {
  expect(collapseTerminal('\x1b[31mred\x1b[0m\n')).toBe('red\n')
  expect(collapseTerminal('\x1b[?25l\x1b[Khello\n')).toBe('hello\n')
})

test('handles pacman multibar progress shape', () => {
  const frames = [
    ' Total (  0/153) 0.0 MiB [---] 0%\r',
    '\x1b[K Total ( 50/153) 200 MiB [###--] 32%\r',
    '\x1b[K Total (153/153) 649 MiB [#####] 100%\n',
  ].join('')
  expect(collapseTerminal(frames)).toBe(' Total (153/153) 649 MiB [#####] 100%\n')
})

test('preserves plain output untouched', () => {
  const s = '( 1/10) installing package linux\n( 2/10) installing package base\n'
  expect(collapseTerminal(s)).toBe(s)
})

test('squashes runs of blank lines to a single blank', () => {
  expect(collapseTerminal('a\n\n\n\n\nb\n')).toBe('a\n\nb\n')
  // whitespace-only lines count as blank
  expect(collapseTerminal('a\n  \n\t\n\nb\n')).toBe('a\n\nb\n')
  // a single blank line is preserved
  expect(collapseTerminal('a\n\nb\n')).toBe('a\n\nb\n')
})

test('trims leading newlines', () => {
  expect(collapseTerminal('\n\n$ cmd\noutput\n')).toBe('$ cmd\noutput\n')
})
