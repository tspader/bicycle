import { $ } from "bun";
import fs from "fs";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";

const isEnabled = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-enabled ${unit}`.quiet().nothrow()).exitCode === 0;

const isActive = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-active ${unit}`.quiet().nothrow()).exitCode === 0;

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const units = config.bicycle().systemd?.enable ?? [];
  for (const unit of units) {
    if ((await isEnabled(unit)) && (await isActive(unit))) continue;
    log.info({ unit }, "systemd: enabling");
    const r = await $`systemctl enable --now ${unit}`.quiet().nothrow();
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
