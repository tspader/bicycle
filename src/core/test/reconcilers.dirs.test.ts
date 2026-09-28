import { Dirs } from '@bicycle/core/reconcilers/dirs'
import { Testing } from '@bicycle/core/testing'

const MEDIA: Testing.System = { users: [{ name: 'media', uid: 1500 }], groups: [{ name: 'shared', gid: 1600 }] }
const OWNED = { dirs: [{ path: '/media', owner: 'media', group: 'shared' }] }

const CASES: Testing.ReconcilerCase[] = [
  {
    name: 'no bicycle.yml: no-op',
    actions: [{ do: 'sweep' }],
    plan: [],
  },
  {
    name: 'no dirs block: no-op',
    actions: [{ do: 'config', config: {} }, { do: 'sweep' }],
    plan: [],
  },
  {
    name: 'creates a directory at the requested path under HOST_ROOT',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media' }] } }, { do: 'sweep' }],
    fs: [{ path: 'media', dir: true }],
  },
  {
    name: 'creates nested directory',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media/movies' }] } }, { do: 'sweep' }],
    fs: [{ path: 'media/movies', dir: true }],
  },
  {
    name: 'applies mode on creation',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media', mode: '0775' }] } }, { do: 'sweep' }],
    fs: [{ path: 'media', dir: true, mode: 0o775 }],
  },
  {
    name: 'idempotent: second pass on existing dir converges',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media', mode: '0775' }] } }, { do: 'sweep' }, { do: 'sweep' }],
    fs: [{ path: 'media', dir: true, mode: 0o775 }],
    plan: [],
  },
  {
    name: 'rejects relative path at config parse time',
    actions: [{ do: 'config', config: { dirs: [{ path: 'media' }] } }, { do: 'sweep' }],
    rejects: true,
  },
  {
    name: 'unknown owner: still creates dir, skips chown',
    actions: [
      { do: 'config', config: { dirs: [{ path: '/media', owner: 'definitely-not-a-real-user-9b3c' }] } },
      { do: 'sweep' },
    ],
    fs: [{ path: 'media', dir: true, owner: Testing.ROOT }],
    warns: ['dirs: owner unknown; skipping chown'],
  },
  {
    name: 'applies owner and group on creation',
    actions: [{ do: 'system', system: MEDIA }, { do: 'config', config: OWNED }, { do: 'sweep' }],
    fs: [{ path: 'media', dir: true, owner: { uid: 1500, gid: 1600 } }],
    plan: [],
  },
  {
    name: 'plan: owner and group drift yield their diffs',
    actions: [{ do: 'system', system: MEDIA }, { do: 'hostDir', rel: 'media' }, { do: 'config', config: OWNED }],
    plan: [
      { type: 'dir', id: '/media', field: 'owner', expected: 1500, actual: 0 },
      { type: 'dir', id: '/media', field: 'group', expected: 1600, actual: 0 },
    ],
  },
  {
    name: 'fixes owner and group drift on an existing dir',
    actions: [
      { do: 'system', system: MEDIA },
      { do: 'hostDir', rel: 'media' },
      { do: 'config', config: OWNED },
      { do: 'sweep' },
    ],
    fs: [{ path: 'media', dir: true, owner: { uid: 1500, gid: 1600 } }],
    plan: [],
  },
  {
    name: 'a chown that is not permitted is logged and the mode is still applied',
    as: Testing.USER,
    actions: [
      { do: 'system', system: MEDIA },
      { do: 'config', config: { dirs: [{ path: '/media', owner: 'media', mode: '0775' }] } },
      { do: 'sweep' },
    ],
    fs: [{ path: 'media', dir: true, owner: Testing.USER, mode: 0o775 }],
    errors: ['dirs: chown failed'],
    plan: [{ type: 'dir', id: '/media', field: 'owner', expected: 1500, actual: 1000 }],
  },
  {
    name: 'plan: missing dir yields an exists diff',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media' }] } }],
    plan: [{ type: 'dir', id: '/media', field: 'exists', expected: true, actual: false }],
  },
  {
    name: 'plan: pre-existing dir with matching mode is clean',
    actions: [
      { do: 'config', config: { dirs: [{ path: '/media', mode: '0775' }] } },
      { do: 'hostDir', rel: 'media', mode: 0o775 },
    ],
    plan: [],
  },
  {
    name: 'plan: mode mismatch yields a mode diff',
    actions: [
      { do: 'config', config: { dirs: [{ path: '/media' }] } },
      { do: 'sweep' },
      { do: 'chmodHost', rel: 'media', mode: 0o755 },
      { do: 'config', config: { dirs: [{ path: '/media', mode: '0775' }] } },
    ],
    plan: [{ type: 'dir', id: '/media', field: 'mode', expected: '0775', actual: '0755' }],
  },
  {
    name: 'fixes mode drift on an existing dir',
    actions: [
      { do: 'config', config: { dirs: [{ path: '/media', mode: '0775' }] } },
      { do: 'hostDir', rel: 'media', mode: 0o755 },
      { do: 'sweep' },
    ],
    fs: [{ path: 'media', dir: true, mode: 0o775 }],
    plan: [],
  },
  {
    name: 'setgid mode converges and plan drains',
    actions: [{ do: 'config', config: { dirs: [{ path: '/media', mode: '02775' }] } }, { do: 'sweep' }],
    fs: [{ path: 'media', dir: true, mode: 0o2775 }],
    plan: [],
  },
]

Testing.reconciles('Dirs.all', Dirs, CASES)
