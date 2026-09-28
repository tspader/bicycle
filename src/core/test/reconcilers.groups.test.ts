import { Groups } from '@bicycle/core/reconcilers/groups'
import { Testing } from '@bicycle/core/testing'

const CASES: Testing.PlanCase[] = [
  {
    name: 'no bicycle.yml yields no diffs',
    sweep: true,
    plan: [],
  },
  {
    name: 'no groups block is clean',
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: 'empty groups is clean',
    config: { groups: [] },
    sweep: true,
    plan: [],
  },
  {
    name: 'existing group with matching gid is clean',
    config: { groups: [{ name: 'root', gid: 0 }] },
    sweep: true,
    plan: [],
  },
  {
    name: 'gid mismatch yields a gid diff',
    config: { groups: [{ name: 'root', gid: 54321 }] },
    plan: [{ type: 'group', id: 'root', field: 'gid', expected: 54321, actual: 0 }],
  },
  {
    name: 'missing group yields an exists diff',
    config: { groups: [{ name: 'bicycle-test-nogroup-9b3c', gid: 54321 }] },
    plan: [
      {
        type: 'group',
        id: 'bicycle-test-nogroup-9b3c',
        field: 'exists',
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: 'no bicycle.yml yields no diffs even with system state',
    system: { groups: [{ name: 'drift', gid: 1500 }] },
    plan: [],
  },
  {
    name: 'undeclared non-system group is reported with its gid',
    config: {},
    system: { groups: [{ name: 'drift', gid: 1500 }] },
    plan: [{ type: 'group', id: 'drift', field: 'exists', expected: null, actual: true, meta: { gid: 1500 } }],
  },
  {
    name: 'user-private group is skipped',
    config: {},
    system: { users: [{ name: 'alice', uid: 1000 }], groups: [{ name: 'alice', gid: 1000 }] },
    plan: [],
  },
  {
    name: 'ids outside the human range are not undeclared',
    config: {},
    system: {
      groups: [
        { name: 'wheelish', gid: 998 },
        { name: 'atcap', gid: 60000 },
      ],
    },
    plan: [],
  },
  {
    name: 'declared and present group is clean, not undeclared',
    config: { groups: [{ name: 'drift', gid: 1500 }] },
    system: { groups: [{ name: 'drift', gid: 1500 }] },
    plan: [],
  },
  {
    name: 'declared-missing and undeclared coexist',
    config: { groups: [{ name: 'bicycle-test-nogroup-9b3c', gid: 54321 }] },
    system: { groups: [{ name: 'drift', gid: 1500 }] },
    plan: [
      { type: 'group', id: 'bicycle-test-nogroup-9b3c', field: 'exists', expected: true, actual: false },
      { type: 'group', id: 'drift', field: 'exists', expected: null, actual: true, meta: { gid: 1500 } },
    ],
  },
]

Testing.plans('Groups.plan', Groups, CASES)

const SWEEP_CASES: Testing.ReconcilerCase[] = [
  {
    name: 'all() does not create undeclared groups',
    actions: [
      { do: 'system', system: { groups: [{ name: 'drift', gid: 1500 }] } },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [{ type: 'group', id: 'drift', field: 'exists', expected: null, actual: true, meta: { gid: 1500 } }],
  },
  {
    name: 'a declared group that is not there is created with its gid',
    actions: [{ do: 'config', config: { groups: [{ name: 'media', gid: 1500 }] } }, { do: 'sweep' }],
    changes: ['groupadd -g 1500 media'],
    plan: [],
  },
  {
    name: 'a second pass creates nothing',
    actions: [{ do: 'config', config: { groups: [{ name: 'media', gid: 1500 }] } }, { do: 'sweep' }, { do: 'sweep' }],
    changes: ['groupadd -g 1500 media'],
    plan: [],
  },
  {
    name: "a live group's gid is never changed",
    actions: [
      { do: 'system', system: { groups: [{ name: 'media', gid: 1500 }] } },
      { do: 'config', config: { groups: [{ name: 'media', gid: 1600 }] } },
      { do: 'sweep' },
    ],
    changes: [],
    warns: ["groups: gid mismatch; refusing to modify live group, run 'groupmod -g <gid> <name>' manually"],
    plan: [{ type: 'group', id: 'media', field: 'gid', expected: 1600, actual: 1500 }],
  },
  {
    name: 'a group that cannot be created is logged and the next is still created',
    actions: [
      { do: 'system', system: { groups: [{ name: 'taken', gid: 1500 }] } },
      {
        do: 'config',
        config: {
          groups: [
            { name: 'media', gid: 1500 },
            { name: 'shared', gid: 1600 },
          ],
        },
      },
      { do: 'sweep' },
    ],
    changes: ['groupadd -g 1600 shared'],
    errors: ['groups: failed to create'],
  },
]

Testing.reconciles('Groups.all', Groups, SWEEP_CASES)
