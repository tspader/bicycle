import { test } from "bun:test";
import { useSandbox, runPlanCase, type PlanCase } from "../testing";
import * as packages from "./packages";

const sb = useSandbox();

const CASES: PlanCase[] = [
  {
    name: "no bicycle.yml yields no diffs",
    sweep: true,
    plan: [],
  },
  {
    name: "no packages block is clean",
    config: {},
    sweep: true,
    plan: [],
  },
  {
    name: "empty packages.extra is clean",
    config: { packages: { extra: [] } },
    sweep: true,
    plan: [],
  },
  {
    name: "missing package yields an installed diff",
    config: { packages: { extra: ["definitely-not-a-real-package-9b3c"] } },
    plan: [
      {
        type: "package",
        id: "definitely-not-a-real-package-9b3c",
        field: "installed",
        expected: true,
        actual: false,
      },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, packages, c));
}
