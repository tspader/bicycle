import { expect } from 'bun:test'
import { Config, type Fail } from '@bicycle/daemon/config'
import { Testing } from '@bicycle/daemon/testing'

type Refusal = { error: Fail.Kind; source: string; names: string[] }

type Case = {
  name: string
  vars: Config.Vars
  file: unknown
  expect: { config: Config } | Refusal
}

const F = 'F'

const defaults: Config = {
  etc: '/etc/bicycle',
  state: '/var/lib/bicycle',
  run: '/run/bicycle',
  root: '/',
  key: '/etc/bicycle/age.key',
  scanner: 'bicycle-fs-scan',
  host: '127.0.0.1',
  port: 7777,
  web: { host: '127.0.0.1', port: 8081 },
  daemon: 'http://127.0.0.1:7777',
  level: 'info',
}

const cases: Case[] = [
  { name: 'defaults', vars: {}, file: {}, expect: { config: defaults } },
  {
    name: 'the key follows the tree',
    vars: {},
    file: { etc: '/t' },
    expect: { config: { ...defaults, etc: '/t', key: '/t/age.key' } },
  },
  {
    name: 'the url follows the host and port',
    vars: {},
    file: { host: 'H', port: 5 },
    expect: { config: { ...defaults, host: 'H', port: 5, daemon: 'http://H:5' } },
  },
  {
    name: 'the web listener is its own',
    vars: {},
    file: { web: { port: 6 } },
    expect: { config: { ...defaults, web: { host: '127.0.0.1', port: 6 } } },
  },
  {
    name: 'the environment is on top of the file',
    vars: {
      BICYCLE_ETC: '/e',
      BICYCLE_VAR: '/v',
      BICYCLE_RUN: '/r',
      BICYCLE_HOST_ROOT: '/h',
      AGE_KEY: '/k',
      BICYCLE_FS_SCANNER: 'S',
      BICYCLE_HOST: 'E',
      BICYCLE_PORT: '6',
      BICYCLE_WEB_HOST: 'W',
      BICYCLE_WEB_PORT: '7',
      BICYCLE_DAEMON_URL: 'http://U/',
      LOG_LEVEL: 'debug',
    },
    file: {
      etc: '/t',
      state: '/s',
      run: '/u',
      root: '/o',
      key: '/y',
      scanner: 'T',
      host: 'H',
      port: 5,
      web: { host: 'X', port: 8 },
      daemon: 'http://V',
      level: 'warn',
    },
    expect: {
      config: {
        etc: '/e',
        state: '/v',
        run: '/r',
        root: '/h',
        key: '/k',
        scanner: 'S',
        host: 'E',
        port: 6,
        web: { host: 'W', port: 7 },
        daemon: 'http://U',
        level: 'debug',
      },
    },
  },
  {
    name: 'a blank variable is unset',
    vars: { BICYCLE_ETC: '', BICYCLE_PORT: '' },
    file: { etc: '/t' },
    expect: { config: { ...defaults, etc: '/t', key: '/t/age.key' } },
  },
  {
    name: 'a port that is not a number',
    vars: { BICYCLE_PORT: 'P' },
    file: {},
    expect: { error: 'bad-config', source: Config.environment, names: ['BICYCLE_PORT'] },
  },
  {
    name: 'a level that is not one',
    vars: { LOG_LEVEL: 'L' },
    file: {},
    expect: { error: 'bad-config', source: Config.environment, names: ['LOG_LEVEL'] },
  },
  {
    name: 'a key the file does not have',
    vars: {},
    file: { prot: 1 },
    expect: { error: 'bad-config', source: F, names: [''] },
  },
  {
    name: 'a port out of range in the file',
    vars: {},
    file: { port: 70000, web: { port: 0 } },
    expect: { error: 'bad-config', source: F, names: ['port', 'web.port'] },
  },
  {
    name: 'a file that is not an object',
    vars: {},
    file: [],
    expect: { error: 'bad-config', source: F, names: [''] },
  },
]

function attempt(it: Case): { config: Config } | Refusal {
  try {
    return { config: Config.parse(it.vars, it.file, F) }
  } catch (error) {
    const fail = error as Fail.Error<'bad-config'>
    return { error: fail.kind, source: fail.data.source, names: fail.data.issues.map((i) => i.path.join('.')) }
  }
}

Testing.each('Config.parse', cases, (it) => {
  expect(attempt(it)).toEqual(it.expect)
})
