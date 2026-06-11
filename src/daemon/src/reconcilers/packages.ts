import { $ } from "bun";
import fs from "fs";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";

const isInstalled = async (pkg: string): Promise<boolean> =>
  (await $`pacman -Qi ${pkg}`.quiet().nothrow()).exitCode === 0;

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const wanted = config.bicycle().packages?.extra ?? [];
  const diffs: Diff[] = [];
  for (const pkg of wanted) {
    if (!(await isInstalled(pkg))) {
      diffs.push({ type: "package", id: pkg, field: "installed", expected: true, actual: false });
    }
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  const missing = (await plan()).map((d) => d.id);
  if (missing.length === 0) return;

  log.info({ packages: missing }, "packages: installing");
  const r = await $`pacman -S --needed --noconfirm ${missing}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { packages: missing, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "packages: failed to install",
    );
    return;
  }
  log.info({ packages: missing }, "packages: installed");
};
