import { test } from "bun:test";
import { useSandbox, runPlanCase, type PlanCase } from "../testing";
import * as systemd from "./systemd";

const sb = useSandbox();

const CASES: PlanCase[] = [
  {
    name: "no bicycle.yml yields no diffs",
    sweep: true,
    plan: [],
  },
  {
    name: "no systemd block is clean",
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: "empty systemd.enable is clean",
    config: { systemd: { enable: [] } },
    sweep: true,
    plan: [],
  },
  {
    name: "unknown unit yields enabled and active diffs",
    config: { systemd: { enable: ["bicycle-test-nonexistent-9b3c.service"] } },
    plan: [
      {
        type: "unit",
        id: "bicycle-test-nonexistent-9b3c.service",
        field: "enabled",
        expected: true,
        actual: false,
      },
      {
        type: "unit",
        id: "bicycle-test-nonexistent-9b3c.service",
        field: "active",
        expected: true,
        actual: false,
      },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, systemd, c));
}
