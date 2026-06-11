import { test } from "bun:test";
import { useSandbox, runPlanCase, type PlanCase } from "../testing";
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
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, users, c));
}
