import { Systemd } from '@bicycle/core/reconcilers/systemd'
import { Testing } from '@bicycle/core/testing'

const CASES: Testing.PlanCase[] = [
  {
    name: 'no bicycle.yml yields no diffs',
    sweep: true,
    plan: [],
  },
  {
    name: 'no systemd block is clean',
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: 'empty systemd.enable is clean',
    config: { systemd: { enable: [] } },
    sweep: true,
    plan: [],
  },
  {
    name: 'unknown unit yields enabled and active diffs',
    config: { systemd: { enable: ['bicycle-test-nonexistent-9b3c.service'] } },
    plan: [
      {
        type: 'unit',
        id: 'bicycle-test-nonexistent-9b3c.service',
        field: 'enabled',
        expected: true,
        actual: false,
      },
      {
        type: 'unit',
        id: 'bicycle-test-nonexistent-9b3c.service',
        field: 'active',
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: 'no bicycle.yml yields no diffs even with system state',
    system: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }] },
    plan: [],
  },
  {
    name: 'undeclared enabled unit with non-enabled preset is reported',
    config: {},
    system: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }] },
    plan: [
      {
        type: 'unit',
        id: 'foo.service',
        field: 'enabled',
        expected: null,
        actual: true,
        meta: { preset: 'disabled' },
      },
    ],
  },
  {
    name: 'vendor-preset-enabled unit is not a diff',
    config: {},
    system: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'enabled' }] },
    plan: [],
  },
  {
    name: 'non-enabled state in unit-files output is skipped',
    config: {},
    system: { unitFiles: [{ unit_file: 'foo.service', state: 'static', preset: null }] },
    plan: [],
  },
  {
    name: 'declared unit is not reported as undeclared',
    config: { systemd: { enable: ['foo.service'] } },
    system: {
      enabled: ['foo.service'],
      active: ['foo.service'],
      unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }],
    },
    plan: [],
  },
  {
    name: 'declared-missing and undeclared coexist',
    config: { systemd: { enable: ['bar.service'] } },
    system: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: null }] },
    plan: [
      { type: 'unit', id: 'bar.service', field: 'enabled', expected: true, actual: false },
      { type: 'unit', id: 'bar.service', field: 'active', expected: true, actual: false },
      {
        type: 'unit',
        id: 'foo.service',
        field: 'enabled',
        expected: null,
        actual: true,
        meta: { preset: null },
      },
    ],
  },
  {
    name: 'declared user unit that is not enabled yields user-unit diffs',
    config: { systemd: { users: { spader: { enable: ['foo.service'] } } } },
    plan: [
      { type: 'user-unit', id: 'spader/foo.service', field: 'enabled', expected: true, actual: false },
      { type: 'user-unit', id: 'spader/foo.service', field: 'active', expected: true, actual: false },
    ],
  },
  {
    name: 'declared user unit that is enabled and active is clean',
    config: { systemd: { users: { spader: { enable: ['foo.service'] } } } },
    system: { userManagers: { spader: { enabled: ['foo.service'], active: ['foo.service'] } } },
    plan: [],
  },
  {
    name: 'user managers are not planned without a systemd.users entry',
    config: { systemd: { enable: [] } },
    system: {
      userManagers: { spader: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }] } },
    },
    plan: [],
  },
  {
    name: 'undeclared enabled user unit with non-enabled preset is reported',
    config: { systemd: { users: { spader: { enable: [] } } } },
    system: {
      userManagers: { spader: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }] } },
    },
    plan: [
      {
        type: 'user-unit',
        id: 'spader/foo.service',
        field: 'enabled',
        expected: null,
        actual: true,
        meta: { preset: 'disabled' },
      },
    ],
  },
  {
    name: 'system and user scopes plan independently',
    config: { systemd: { enable: ['a.service'], users: { spader: { enable: ['b.service'] } } } },
    system: { enabled: ['a.service'], active: ['a.service'], userManagers: { spader: { enabled: ['a.service'] } } },
    plan: [
      { type: 'user-unit', id: 'spader/b.service', field: 'enabled', expected: true, actual: false },
      { type: 'user-unit', id: 'spader/b.service', field: 'active', expected: true, actual: false },
    ],
  },
]

Testing.plans('Systemd.plan', Systemd, CASES)

const SWEEP_CASES: Testing.ReconcilerCase[] = [
  {
    name: 'all() does not enable undeclared units',
    actions: [
      {
        do: 'system',
        system: { unitFiles: [{ unit_file: 'foo.service', state: 'enabled', preset: 'disabled' }] },
      },
      { do: 'config', config: {} },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [
      {
        type: 'unit',
        id: 'foo.service',
        field: 'enabled',
        expected: null,
        actual: true,
        meta: { preset: 'disabled' },
      },
    ],
  },
  {
    name: 'all() reloads once and enables every declared unit that is not enabled and active',
    actions: [
      { do: 'system', system: { enabled: ['a.service', 'b.service'], active: ['a.service'] } },
      { do: 'config', config: { systemd: { enable: ['a.service', 'b.service', 'c.service'] } } },
      { do: 'sweep' },
    ],
    changes: ['systemctl daemon-reload', 'systemctl enable --now b.service', 'systemctl enable --now c.service'],
    plan: [],
  },
  {
    name: 'all() does nothing when every declared unit is enabled and active',
    actions: [
      { do: 'system', system: { enabled: ['a.service'], active: ['a.service'] } },
      { do: 'config', config: { systemd: { enable: ['a.service'] } } },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [],
  },
  {
    name: 'all() reloads and enables declared user units through the user manager',
    actions: [
      { do: 'config', config: { systemd: { users: { spader: { enable: ['foo.service'] } } } } },
      { do: 'sweep' },
    ],
    changes: ['systemctl --user -M spader@ daemon-reload', 'systemctl --user -M spader@ enable --now foo.service'],
    plan: [],
  },
  {
    name: 'a unit that cannot be enabled is logged and the next is still enabled',
    actions: [
      { do: 'fault', program: 'systemctl', args: ['enable', 'a.service'], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: { systemd: { enable: ['a.service', 'b.service'] } } },
      { do: 'sweep' },
    ],
    changes: ['systemctl daemon-reload', 'systemctl enable --now b.service'],
    errors: ['systemd: failed to enable'],
  },
]

Testing.reconciles('Systemd.all', Systemd, SWEEP_CASES)
