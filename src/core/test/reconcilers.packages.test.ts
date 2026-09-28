import { Packages } from '@bicycle/core/reconcilers/packages'
import { Testing } from '@bicycle/core/testing'

const CASES: Testing.PlanCase[] = [
  {
    name: 'no bicycle.yml yields no diffs',
    sweep: true,
    plan: [],
  },
  {
    name: 'no packages block is clean',
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: 'empty packages.extra is clean',
    config: { packages: { extra: [] } },
    sweep: true,
    plan: [],
  },
  {
    name: 'missing package yields an installed diff',
    config: { packages: { extra: ['definitely-not-a-real-package-9b3c'] } },
    plan: [
      {
        type: 'package',
        id: 'definitely-not-a-real-package-9b3c',
        field: 'installed',
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: 'no bicycle.yml yields no diffs even with system state',
    system: { explicit: ['neofetch'] },
    plan: [],
  },
  {
    name: 'declared and installed package is clean',
    config: { packages: { extra: ['git'] } },
    system: { installed: ['git'], explicit: ['git'] },
    plan: [],
  },
  {
    name: 'undeclared explicit package yields an undeclared diff',
    config: {},
    system: { explicit: ['neofetch'] },
    plan: [{ type: 'package', id: 'neofetch', field: 'installed', expected: null, actual: true }],
  },
  {
    name: 'undeclared foreign package carries foreign meta',
    config: {},
    system: { foreign: ['yay'] },
    plan: [
      {
        type: 'package',
        id: 'yay',
        field: 'installed',
        expected: null,
        actual: true,
        meta: { foreign: true },
      },
    ],
  },
  {
    name: 'declaration in any package set suppresses undeclared',
    config: { packages: { base: ['git'], extra: ['vim'] } },
    system: { installed: ['git', 'vim'], explicit: ['git', 'vim'] },
    plan: [],
  },
  {
    name: 'declared-missing and undeclared coexist',
    config: { packages: { extra: ['git'] } },
    system: { explicit: ['neofetch'] },
    plan: [
      { type: 'package', id: 'git', field: 'installed', expected: true, actual: false },
      { type: 'package', id: 'neofetch', field: 'installed', expected: null, actual: true },
    ],
  },
]

Testing.plans('Packages.plan', Packages, CASES)

const SWEEP_CASES: Testing.ReconcilerCase[] = [
  {
    name: 'all() does not install undeclared packages',
    actions: [{ do: 'system', system: { explicit: ['neofetch'] } }, { do: 'config', config: {} }, { do: 'sweep' }],
    changes: [],
    plan: [{ type: 'package', id: 'neofetch', field: 'installed', expected: null, actual: true }],
  },
  {
    name: 'what is declared and missing is installed in one transaction',
    actions: [
      { do: 'system', system: { installed: ['git'], explicit: ['git'] } },
      { do: 'config', config: { packages: { extra: ['git', 'vim', 'tmux'] } } },
      { do: 'sweep' },
    ],
    changes: ['pacman -S --needed --noconfirm vim tmux'],
    plan: [],
  },
  {
    name: 'nothing missing installs nothing',
    actions: [
      { do: 'system', system: { installed: ['git'], explicit: ['git'] } },
      { do: 'config', config: { packages: { extra: ['git'] } } },
      { do: 'sweep' },
    ],
    changes: [],
    plan: [],
  },
  {
    name: 'an install that fails is logged',
    actions: [
      { do: 'fault', program: 'pacman', args: ['-S'], reply: { code: 1, stderr: 'E' } },
      { do: 'config', config: { packages: { extra: ['vim'] } } },
      { do: 'sweep' },
    ],
    changes: [],
    errors: ['packages: failed to install'],
    plan: [{ type: 'package', id: 'vim', field: 'installed', expected: true, actual: false }],
  },
]

Testing.reconciles('Packages.all', Packages, SWEEP_CASES)
