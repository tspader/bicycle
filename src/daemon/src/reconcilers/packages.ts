import { $ } from "bun";
import fs from "fs";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";

const isInstalled = async (pkg: string): Promise<boolean> =>
  (await $`pacman -Qi ${pkg}`.quiet().nothrow()).exitCode === 0;

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = config.bicycle().packages?.extra ?? [];
  if (wanted.length === 0) return;

  const missing: string[] = [];
  for (const pkg of wanted) {
    if (!(await isInstalled(pkg))) missing.push(pkg);
  }
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
