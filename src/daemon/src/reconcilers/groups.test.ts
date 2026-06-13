import { test } from "bun:test";
import {
  useSandbox,
  runPlanCase,
  runReconcilerCase,
  type PlanCase,
  type ReconcilerCase,
} from "../testing";
import * as groups from "./groups";

const sb = useSandbox();

const CASES: PlanCase[] = [
  {
    name: "no bicycle.yml yields no diffs",
    sweep: true,
    plan: [],
  },
  {
    name: "no groups block is clean",
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: "empty groups is clean",
    config: { groups: [] },
    sweep: true,
    plan: [],
  },
  {
    name: "existing group with matching gid is clean",
    config: { groups: [{ name: "root", gid: 0 }] },
    sweep: true,
    plan: [],
  },
  {
    name: "gid mismatch yields a gid diff",
    config: { groups: [{ name: "root", gid: 54321 }] },
    plan: [{ type: "group", id: "root", field: "gid", expected: 54321, actual: 0 }],
  },
  {
    name: "missing group yields an exists diff",
    config: { groups: [{ name: "bicycle-test-nogroup-9b3c", gid: 54321 }] },
    plan: [
      {
        type: "group",
        id: "bicycle-test-nogroup-9b3c",
        field: "exists",
        expected: true,
        actual: false,
      },
    ],
  },
  {
    name: "no bicycle.yml yields no diffs even with system state",
    system: { groups: [{ name: "drift", gid: 1500 }] },
    plan: [],
  },
  {
    name: "undeclared non-system group is reported with its gid",
    config: {},
    system: { groups: [{ name: "drift", gid: 1500 }] },
    plan: [
      { type: "group", id: "drift", field: "exists", expected: null, actual: true, meta: { gid: 1500 } },
    ],
  },
  {
    name: "user-private group is skipped",
    config: {},
    system: { users: [{ name: "alice", uid: 1000 }], groups: [{ name: "alice", gid: 1000 }] },
    plan: [],
  },
  {
    name: "ids outside the human range are not undeclared",
    config: {},
    system: {
      groups: [
        { name: "wheelish", gid: 998 },
        { name: "atcap", gid: 60000 },
      ],
    },
    plan: [],
  },
  {
    name: "declared and present group is clean, not undeclared",
    config: { groups: [{ name: "drift", gid: 1500 }] },
    system: { groups: [{ name: "drift", gid: 1500 }] },
    plan: [],
  },
  {
    name: "declared-missing and undeclared coexist",
    config: { groups: [{ name: "bicycle-test-nogroup-9b3c", gid: 54321 }] },
    system: { groups: [{ name: "drift", gid: 1500 }] },
    plan: [
      { type: "group", id: "bicycle-test-nogroup-9b3c", field: "exists", expected: true, actual: false },
      { type: "group", id: "drift", field: "exists", expected: null, actual: true, meta: { gid: 1500 } },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, groups, c));
}

const SWEEP_CASES: ReconcilerCase[] = [
  {
    name: "all() does not create undeclared groups",
    actions: [
      { do: "system", system: { groups: [{ name: "drift", gid: 1500 }] } },
      { do: "config", config: {} },
      {
        do: "shim",
        name: "groupadd",
        script: '#!/bin/sh\ntouch "$BICYCLE_HOST_ROOT/groupadd"\nexit 0\n',
      },
      { do: "sweep" },
    ],
    fs: [{ path: "groupadd", absent: true }],
    plan: [
      { type: "group", id: "drift", field: "exists", expected: null, actual: true, meta: { gid: 1500 } },
    ],
  },
];

for (const c of SWEEP_CASES) {
  test(c.name, () => runReconcilerCase(sb, groups, () => groups.all(), c));
}
