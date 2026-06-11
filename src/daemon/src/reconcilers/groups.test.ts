import { test } from "bun:test";
import { useSandbox, runPlanCase, type PlanCase } from "../testing";
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
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, groups, c));
}
