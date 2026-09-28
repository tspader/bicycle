import { Users } from '@bicycle/core/reconcilers/users'
import { Testing } from '@bicycle/core/testing'

const CASES: Testing.PlanCase[] = [
  {
    name: 'no bicycle.yml yields no diffs',
    sweep: true,
    plan: [],
  },
  {
    name: 'no users block is clean',
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: 'empty users is clean',
    config: { users: [] },
    sweep: true,
    plan: [],
  },
  {
    name: 'existing root user with no extra groups is clean',
    config: { users: [{ name: 'root', sudo: 'none', groups: [] }] },
    sweep: true,
    plan: [],
  },
  {
    name: 'missing user yields an exists diff',
    config: { users: [{ name: 'bicycle-test-nouser-9b3c', sudo: 'none', groups: [] }] },
    plan: [
      {
        type: 'user',
        id: 'bicycle-test-nouser-9b3c',
        field: 'exists',
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: 'uid mismatch yields a uid diff',
    config: { users: [{ name: 'root', uid: 54321, sudo: 'none', groups: [] }] },
    plan: [{ type: 'user', id: 'root', field: 'uid', expected: 54321, actual: 0 }],
  },
  {
    name: 'missing supplementary group yields a groups diff',
    config: { users: [{ name: 'root', sudo: 'none', groups: ['bicycle-test-nogroup-9b3c'] }] },
    plan: [
      {
        type: 'user',
        id: 'root',
        field: 'groups',
        expected: ['bicycle-test-nogroup-9b3c'],
      },
    ],
  },
  {
    name: 'sudo user implies wheel membership in expected groups',
    config: { users: [{ name: 'root', sudo: 'password', groups: [] }] },
    plan: [{ type: 'user', id: 'root', field: 'groups', expected: ['wheel'] }],
  },
  {
    name: 'no bicycle.yml yields no diffs even with system state',
    system: { users: [{ name: 'drifter', uid: 1500 }] },
    plan: [],
  },
  {
    name: 'undeclared human user is reported with its uid',
    config: {},
    system: { users: [{ name: 'drifter', uid: 1500 }] },
    plan: [{ type: 'user', id: 'drifter', field: 'exists', expected: null, actual: true, meta: { uid: 1500 } }],
  },
  {
    name: 'ids outside the human range are not undeclared',
    config: {},
    system: {
      users: [
        { name: 'daemonish', uid: 999 },
        { name: 'atcap', uid: 60000 },
        { name: 'nobodyish', uid: 65534 },
      ],
    },
    plan: [],
  },
  {
    name: 'declared and present user is clean, not undeclared',
    config: { users: [{ name: 'drifter', uid: 1500, sudo: 'none', groups: [] }] },
    system: { users: [{ name: 'drifter', uid: 1500 }] },
    plan: [],
  },
  {
    name: 'declared-missing and undeclared coexist',
    config: { users: [{ name: 'bicycle-test-nouser-9b3c', sudo: 'none', groups: [] }] },
    system: { users: [{ name: 'drifter', uid: 2000 }] },
    plan: [
      { type: 'user', id: 'bicycle-test-nouser-9b3c', field: 'exists', expected: true, actual: false },
      { type: 'user', id: 'drifter', field: 'exists', expected: null, actual: true, meta: { uid: 2000 } },
    ],
  },
]

Testing.plans('Users.plan', Users, CASES)

const PASSWORD = '${secret:users/bob}'
const BOB = { name: 'bob', sudo: 'none', groups: [] }
const LIVE: Testing.System = { users: [{ name: 'bob', uid: 1500, groups: ['a'] }], groups: [{ name: 'a', gid: 1600 }] }

const SWEEP_CASES: Testing.ReconcilerCase[] = [
  {
    name: 'all() does not create undeclared users',
    actions: [
      { do: 'system', system: { users: [{ name: 'drifter', uid: 1500 }] } },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [{ type: 'user', id: 'drifter', field: 'exists', expected: null, actual: true, meta: { uid: 1500 } }],
  },
  {
    name: 'a declared user that is not there is created with its uid and groups',
    actions: [
      { do: 'system', system: { groups: [{ name: 'media', gid: 1600 }] } },
      { do: 'config', config: { users: [{ name: 'bob', uid: 1500, sudo: 'password', groups: ['media'] }] } },
      { do: 'sweep' },
    ],
    changes: ['useradd -m -u 1500 -G media,wheel -- bob'],
    plan: [],
  },
  {
    name: 'a user with no uid and no groups is created with neither',
    actions: [{ do: 'config', config: { users: [BOB] } }, { do: 'sweep' }],
    changes: ['useradd -m -- bob'],
    plan: [],
  },
  {
    name: 'a password is set from stdin when the user is created',
    actions: [
      { do: 'secret', addr: 'users/bob', clear: 'hunter2' },
      { do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } },
      { do: 'sweep' },
    ],
    changes: ['useradd -m -- bob', 'chpasswd < bob:hunter2'],
    plan: [],
  },
  {
    name: 'a password is not set for a user that is already there',
    actions: [
      { do: 'system', system: { users: [{ name: 'bob', uid: 1500 }] } },
      { do: 'secret', addr: 'users/bob', clear: 'hunter2' },
      { do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [],
  },
  {
    name: 'a second pass does not set the password again',
    actions: [
      { do: 'secret', addr: 'users/bob', clear: 'hunter2' },
      { do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } },
      { do: 'sweep' },
      { do: 'sweep' },
    ],
    changes: ['useradd -m -- bob', 'chpasswd < bob:hunter2'],
    plan: [],
  },
  {
    name: 'an empty password is never set',
    actions: [
      { do: 'secret', addr: 'users/bob', clear: '' },
      { do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } },
      { do: 'sweep' },
    ],
    changes: ['useradd -m -- bob'],
    errors: ['users: password secret is empty; not setting password'],
  },
  {
    name: 'a password secret that is not there is logged and the user is still created',
    actions: [{ do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } }, { do: 'sweep' }],
    changes: ['useradd -m -- bob'],
    errors: ['users: failed to resolve password secret'],
    plan: [],
  },
  {
    name: 'a user that could not be created is given no password',
    actions: [
      { do: 'fault', program: 'useradd', args: [], reply: { code: 1, stderr: 'E' } },
      { do: 'secret', addr: 'users/bob', clear: 'hunter2' },
      { do: 'config', config: { users: [{ ...BOB, password: PASSWORD }] } },
      { do: 'sweep' },
    ],
    changes: [],
    errors: ['users: useradd failed'],
  },
  {
    name: 'a user whose group is not there cannot be created',
    actions: [{ do: 'config', config: { users: [{ ...BOB, groups: ['media'] }] } }, { do: 'sweep' }],
    changes: [],
    errors: ['users: useradd failed'],
  },
  {
    name: "a live user's uid is never changed",
    actions: [
      { do: 'system', system: LIVE },
      { do: 'config', config: { users: [{ ...BOB, uid: 1600, groups: ['a'] }] } },
      { do: 'sweep' },
    ],
    changes: [],
    warns: ["users: uid mismatch; refusing to modify live user, run 'usermod -u <uid> <name>' manually"],
    plan: [{ type: 'user', id: 'bob', field: 'uid', expected: 1600, actual: 1500 }],
  },
  {
    name: 'a live user is added to the groups it is missing, and to no others',
    actions: [
      { do: 'system', system: { ...LIVE, groups: [...LIVE.groups!, { name: 'b', gid: 1601 }] } },
      { do: 'config', config: { users: [{ ...BOB, sudo: 'passwordless', groups: ['a', 'b'] }] } },
      { do: 'sweep' },
    ],
    changes: ['usermod -aG b,wheel bob'],
    plan: [],
  },
  {
    name: 'a live user is never taken out of a group',
    actions: [{ do: 'system', system: LIVE }, { do: 'config', config: { users: [BOB] } }, { do: 'sweep' }],
    changes: [],
    plan: [],
  },
]

Testing.reconciles('Users.all', Users, SWEEP_CASES)
