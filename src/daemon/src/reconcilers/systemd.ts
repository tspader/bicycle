import { $ } from "bun";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { log } from "../logger";
import { bin } from "./bin";

type Manager = { type: string; flags: string[]; prefix: string };

type Target = { manager: Manager; units: string[] };

type UnitFile = { unit_file: string; state: string; preset: string | null };

type Observed = {
  manager: Manager;
  units: { unit: string; enabled: boolean; active: boolean }[];
  undeclared: UnitFile[];
};

const SYSTEM: Manager = { type: "unit", flags: [], prefix: "" };

const targets = (cfg: config.BicycleConfig): Target[] => [
  { manager: SYSTEM, units: cfg.systemd?.enable ?? [] },
  ...Object.entries(cfg.systemd?.users ?? {}).map(([user, u]) => ({
    manager: { type: "user-unit", flags: ["--user", "-M", `${user}@`], prefix: `${user}/` },
    units: u.enable ?? [],
  })),
];

const systemctl = (m: Manager, args: string[]) =>
  $`${bin("systemctl")} ${m.flags} ${args}`.quiet().nothrow();

const observe = async (t: Target): Promise<Observed> => {
  const units: Observed["units"] = [];
  for (const unit of t.units) {
    units.push({
      unit,
      enabled: (await systemctl(t.manager, ["is-enabled", unit])).exitCode === 0,
      active: (await systemctl(t.manager, ["is-active", unit])).exitCode === 0,
    });
  }
  const listed = await systemctl(t.manager, ["list-unit-files", "--state=enabled", "--output=json"]);
  let files: UnitFile[] = [];
  if (listed.exitCode === 0) {
    try {
      files = JSON.parse(listed.stdout.toString()) as UnitFile[];
    } catch {}
  }
  const want = new Set(t.units);
  const undeclared = files.filter(
    (u) => u.state === "enabled" && u.preset !== "enabled" && !want.has(u.unit_file),
  );
  return { manager: t.manager, units, undeclared };
};

export const plan = async (): Promise<Diff[]> => {
  const cfg = config.maybe();
  if (!cfg) return [];
  const diffs: Diff[] = [];
  for (const t of targets(cfg)) {
    const o = await observe(t);
    const { type, prefix } = o.manager;
    for (const u of o.units) {
      if (!u.enabled) {
        diffs.push({ type, id: prefix + u.unit, field: "enabled", expected: true, actual: false });
      }
      if (!u.active) {
        diffs.push({ type, id: prefix + u.unit, field: "active", expected: true, actual: false });
      }
    }
    for (const u of o.undeclared) {
      diffs.push({
        type,
        id: prefix + u.unit_file,
        field: "enabled",
        expected: null,
        actual: true,
        meta: { preset: u.preset },
      });
    }
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  const cfg = config.maybe();
  if (!cfg) return;
  for (const t of targets(cfg)) {
    const o = await observe(t);
    const pending = o.units.filter((u) => !u.enabled || !u.active).map((u) => u.unit);
    if (pending.length === 0) continue;
    const reload = await systemctl(o.manager, ["daemon-reload"]);
    if (reload.exitCode !== 0) {
      log.warn(
        { exitCode: reload.exitCode, stderr: reload.stderr.toString().trim() },
        "systemd: daemon-reload failed",
      );
    }
    for (const unit of pending) {
      const id = o.manager.prefix + unit;
      log.info({ unit: id }, "systemd: enabling");
      const r = await systemctl(o.manager, ["enable", "--now", unit]);
      if (r.exitCode !== 0) {
        log.error(
          { unit: id, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
          "systemd: failed to enable",
        );
        continue;
      }
      log.info({ unit: id }, "systemd: enabled");
    }
  }
};
