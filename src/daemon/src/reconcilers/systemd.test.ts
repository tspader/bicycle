import { test } from "bun:test";
import {
  useSandbox,
  runPlanCase,
  runReconcilerCase,
  type PlanCase,
  type ReconcilerCase,
} from "../testing";
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
  {
    name: "no bicycle.yml yields no diffs even with system state",
    system: { unitFiles: [{ unit_file: "foo.service", state: "enabled", preset: "disabled" }] },
    plan: [],
  },
  {
    name: "undeclared enabled unit with non-enabled preset is reported",
    config: {},
    system: { unitFiles: [{ unit_file: "foo.service", state: "enabled", preset: "disabled" }] },
    plan: [
      {
        type: "unit",
        id: "foo.service",
        field: "enabled",
        expected: null,
        actual: true,
        meta: { preset: "disabled" },
      },
    ],
  },
  {
    name: "vendor-preset-enabled unit is not a diff",
    config: {},
    system: { unitFiles: [{ unit_file: "foo.service", state: "enabled", preset: "enabled" }] },
    plan: [],
  },
  {
    name: "non-enabled state in unit-files output is skipped",
    config: {},
    system: { unitFiles: [{ unit_file: "foo.service", state: "static", preset: null }] },
    plan: [],
  },
  {
    name: "declared unit is not reported as undeclared",
    config: { systemd: { enable: ["foo.service"] } },
    system: {
      enabled: ["foo.service"],
      active: ["foo.service"],
      unitFiles: [{ unit_file: "foo.service", state: "enabled", preset: "disabled" }],
    },
    plan: [],
  },
  {
    name: "declared-missing and undeclared coexist",
    config: { systemd: { enable: ["bar.service"] } },
    system: { unitFiles: [{ unit_file: "foo.service", state: "enabled", preset: null }] },
    plan: [
      { type: "unit", id: "bar.service", field: "enabled", expected: true, actual: false },
      { type: "unit", id: "bar.service", field: "active", expected: true, actual: false },
      {
        type: "unit",
        id: "foo.service",
        field: "enabled",
        expected: null,
        actual: true,
        meta: { preset: null },
      },
    ],
  },
];

for (const c of CASES) {
  test(c.name, () => runPlanCase(sb, systemd, c));
}

const SWEEP_CASES: ReconcilerCase[] = [
  {
    name: "all() does not enable undeclared units",
    actions: [
      { do: "config", config: {} },
      {
        do: "shim",
        name: "systemctl",
        script: [
          "#!/bin/sh",
          'case "$1" in',
          '  enable) touch "$BICYCLE_HOST_ROOT/systemctl-enable"; exit 0;;',
          "  list-unit-files) echo '[{\"unit_file\":\"foo.service\",\"state\":\"enabled\",\"preset\":\"disabled\"}]'; exit 0;;",
          "  *) exit 1;;",
          "esac",
          "",
        ].join("\n"),
      },
      { do: "sweep" },
    ],
    fs: [{ path: "systemctl-enable", absent: true }],
    plan: [
      {
        type: "unit",
        id: "foo.service",
        field: "enabled",
        expected: null,
        actual: true,
        meta: { preset: "disabled" },
      },
    ],
  },
];

for (const c of SWEEP_CASES) {
  test(c.name, () => runReconcilerCase(sb, systemd, () => systemd.all(), c));
}
