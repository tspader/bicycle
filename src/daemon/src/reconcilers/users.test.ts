import { test } from "bun:test";
import {
  useSandbox,
  runPlanCase,
  runReconcilerCase,
  type PlanCase,
  type ReconcilerCase,
} from "../testing";
import * as users from "./users";

const sb = useSandbox();

const CASES: PlanCase[] = [
  {
    name: "no bicycle.yml yields no diffs",
    sweep: true,
    plan: [],
  },
  {
    name: "no users block is clean",
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: "empty users is clean",
    config: { users: [] },
    sweep: true,
    plan: [],
  },
  {
    name: "existing root user with no extra groups is clean",
    config: { users: [{ name: "root", sudo: "none", groups: [] }] },
    sweep: true,
    plan: [],
  },
  {
    name: "missing user yields an exists diff",
    config: { users: [{ name: "bicycle-test-nouser-9b3c", sudo: "none", groups: [] }] },
    plan: [
      {
        type: "user",
        id: "bicycle-test-nouser-9b3c",
        field: "exists",
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: "uid mismatch yields a uid diff",
    config: { users: [{ name: "root", uid: 54321, sudo: "none", groups: [] }] },
    plan: [{ type: "user", id: "root", field: "uid", expected: 54321, actual: 0 }],
  },
  {
    name: "missing supplementary group yields a groups diff",
    config: { users: [{ name: "root", sudo: "none", groups: ["bicycle-test-nogroup-9b3c"] }] },
    plan: [
      {
        type: "user",
        id: "root",
        field: "groups",
        expected: ["bicycle-test-nogroup-9b3c"],
      },
    ],
  },
  {
    name: "sudo user implies wheel membership in expected groups",
    config: { users: [{ name: "root", sudo: "password", groups: [] }] },
    plan: [{ type: "user", id: "root", field: "groups", expected: ["wheel"] }],
  },
  {
    name: "no bicycle.yml yields no diffs even with system state",
    system: { users: [{ name: "drifter", uid: 1500 }] },
    plan: [],
  },
  {
    name: "undeclared human user is reported with its uid",
    config: {},
    system: { users: [{ name: "drifter", uid: 1500 }] },
    plan: [
      { type: "user", id: "drifter", field: "exists", expected: null, actual: true, meta: { uid: 1500 } },
    ],
  },
  {
    name: "ids outside the human range are not undeclared",
    config: {},
    system: {
      users: [
        { name: "daemonish", uid: 999 },
        { name: "atcap", uid: 60000 },
        { name: "nobodyish", uid: 65534 },
      ],
    },
    plan: [],
  },
  {
    name: "declared and present user is clean, not undeclared",
    config: { users: [{ name: "drifter", uid: 1500, sudo: "none", groups: [] }] },
    system: { users: [{ name: "drifter", uid: 1500 }] },
    plan: [],
  },
  {
    name: "declared-missing and undeclared coexist",
    config: { users: [{ name: "bicycle-test-nouser-9b3c", sudo: "none", groups: [] }] },
    system: { users: [{ name: "drifter", uid: 2000 }] },
    plan: [
      { type: "user", id: "bicycle-test-nouser-9b3c", field: "exists", expected: true, actual: false },
      { type: "user", id: "drifter", field: "exists", expected: null, actual: true, meta: { uid: 2000 } },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, users, c));
}

const SWEEP_CASES: ReconcilerCase[] = [
  {
    name: "all() does not create undeclared users",
    actions: [
      { do: "system", system: { users: [{ name: "drifter", uid: 1500 }] } },
      { do: "config", config: {} },
      {
        do: "shim",
        name: "useradd",
        script: '#!/bin/sh\ntouch "$BICYCLE_HOST_ROOT/useradd"\nexit 0\n',
      },
      { do: "sweep" },
    ],
    fs: [{ path: "useradd", absent: true }],
    plan: [
      { type: "user", id: "drifter", field: "exists", expected: null, actual: true, meta: { uid: 1500 } },
    ],
  },
];

for (const c of SWEEP_CASES) {
  test(c.name, () => runReconcilerCase(sb, users, () => users.all(), c));
}
