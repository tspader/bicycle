import { test } from "bun:test";
import {
  useSandbox,
  runPlanCase,
  runReconcilerCase,
  type PlanCase,
  type ReconcilerCase,
} from "../testing";
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
  {
    name: "no bicycle.yml yields no diffs even with system state",
    system: { explicit: ["neofetch"] },
    plan: [],
  },
  {
    name: "declared and installed package is clean",
    config: { packages: { extra: ["git"] } },
    system: { installed: ["git"], explicit: ["git"] },
    plan: [],
  },
  {
    name: "undeclared explicit package yields an undeclared diff",
    config: {},
    system: { explicit: ["neofetch"] },
    plan: [{ type: "package", id: "neofetch", field: "installed", expected: null, actual: true }],
  },
  {
    name: "undeclared foreign package carries foreign meta",
    config: {},
    system: { foreign: ["yay"] },
    plan: [
      {
        type: "package",
        id: "yay",
        field: "installed",
        expected: null,
        actual: true,
        meta: { foreign: true },
      },
    ],
  },
  {
    name: "declaration in any package set suppresses undeclared",
    config: { packages: { base: ["git"], extra: ["vim"] } },
    system: { installed: ["git", "vim"], explicit: ["git", "vim"] },
    plan: [],
  },
  {
    name: "declared-missing and undeclared coexist",
    config: { packages: { extra: ["git"] } },
    system: { explicit: ["neofetch"] },
    plan: [
      { type: "package", id: "git", field: "installed", expected: true, actual: false },
      { type: "package", id: "neofetch", field: "installed", expected: null, actual: true },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, packages, c));
}

const SWEEP_CASES: ReconcilerCase[] = [
  {
    name: "all() does not install undeclared packages",
    actions: [
      { do: "config", config: {} },
      {
        do: "shim",
        name: "pacman",
        script: [
          "#!/bin/sh",
          'case "$1" in',
          '  -S) touch "$BICYCLE_HOST_ROOT/pacman-S"; exit 0;;',
          '  -Qen) echo "neofetch 1.0-1"; exit 0;;',
          "  -Qq|-Qem) exit 0;;",
          "  *) exit 1;;",
          "esac",
          "",
        ].join("\n"),
      },
      { do: "sweep" },
    ],
    fs: [{ path: "pacman-S", absent: true }],
    plan: [{ type: "package", id: "neofetch", field: "installed", expected: null, actual: true }],
  },
];

for (const c of SWEEP_CASES) {
  test(c.name, () => runReconcilerCase(sb, packages, () => packages.all(), c));
}
