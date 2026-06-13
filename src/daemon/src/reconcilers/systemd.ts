import { $ } from "bun";
import fs from "fs";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";
import { bin } from "./bin";

const isEnabled = async (unit: string): Promise<boolean> =>
  (await $`${bin("systemctl")} is-enabled ${unit}`.quiet().nothrow()).exitCode === 0;

const isActive = async (unit: string): Promise<boolean> =>
  (await $`${bin("systemctl")} is-active ${unit}`.quiet().nothrow()).exitCode === 0;

type UnitFile = { unit_file: string; state: string; preset: string | null };

const enabledUnitFiles = async (): Promise<UnitFile[]> => {
  const r = await $`${bin("systemctl")} list-unit-files --state=enabled --output=json`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  try {
    return JSON.parse(r.stdout.toString()) as UnitFile[];
  } catch {
    return [];
  }
};

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const units = config.bicycle().systemd?.enable ?? [];
  const diffs: Diff[] = [];
  for (const unit of units) {
    if (!(await isEnabled(unit))) {
      diffs.push({ type: "unit", id: unit, field: "enabled", expected: true, actual: false });
    }
    if (!(await isActive(unit))) {
      diffs.push({ type: "unit", id: unit, field: "active", expected: true, actual: false });
    }
  }
  const declared = new Set(units);
  for (const u of await enabledUnitFiles()) {
    if (u.state !== "enabled" || u.preset === "enabled" || declared.has(u.unit_file)) continue;
    diffs.push({
      type: "unit",
      id: u.unit_file,
      field: "enabled",
      expected: null,
      actual: true,
      meta: { preset: u.preset },
    });
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  const units = [
    ...new Set((await plan()).filter((d) => d.expected !== null).map((d) => d.id)),
  ];
  for (const unit of units) {
    log.info({ unit }, "systemd: enabling");
    const r = await $`${bin("systemctl")} enable --now ${unit}`.quiet().nothrow();
    if (r.exitCode !== 0) {
      log.error(
        { unit, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
        "systemd: failed to enable",
      );
      continue;
    }
    log.info({ unit }, "systemd: enabled");
  }
};
