import { $ } from "bun";
import fs from "fs";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";
import { bin } from "./bin";

const query = async (flag: string): Promise<string[]> => {
  const r = await $`${bin("pacman")} ${flag}`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  return r.stdout
    .toString()
    .split("\n")
    .map((l) => l.split(/\s+/)[0]!)
    .filter(Boolean);
};

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const sets = config.bicycle().packages ?? {};
  const wanted = sets.extra ?? [];
  const installed = new Set(await query("-Qq"));
  const diffs: Diff[] = [];
  for (const pkg of wanted) {
    if (!installed.has(pkg)) {
      diffs.push({ type: "package", id: pkg, field: "installed", expected: true, actual: false });
    }
  }
  const declared = new Set(Object.values(sets).flat());
  for (const pkg of await query("-Qen")) {
    if (!declared.has(pkg)) {
      diffs.push({ type: "package", id: pkg, field: "installed", expected: null, actual: true });
    }
  }
  for (const pkg of await query("-Qem")) {
    if (!declared.has(pkg)) {
      diffs.push({
        type: "package",
        id: pkg,
        field: "installed",
        expected: null,
        actual: true,
        meta: { foreign: true },
      });
    }
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  const missing = (await plan())
    .filter((d) => d.expected !== null)
    .map((d) => d.id);
  if (missing.length === 0) return;

  log.info({ packages: missing }, "packages: installing");
  const r = await $`${bin("pacman")} -S --needed --noconfirm ${missing}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { packages: missing, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "packages: failed to install",
    );
    return;
  }
  log.info({ packages: missing }, "packages: installed");
};
