import { $ } from "bun";
import * as config from "../config";
import { log } from "../logger";

const isEnabled = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-enabled ${unit}`.quiet().nothrow()).exitCode === 0;

const isActive = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-active ${unit}`.quiet().nothrow()).exitCode === 0;

export const reconcile = async (): Promise<void> => {
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
