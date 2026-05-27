import { $ } from "bun";
import * as config from "../config";

const isEnabled = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-enabled ${unit}`.quiet().nothrow()).exitCode === 0;

const isActive = async (unit: string): Promise<boolean> =>
  (await $`systemctl is-active ${unit}`.quiet().nothrow()).exitCode === 0;

export const reconcile = async (): Promise<void> => {
  const units = config.bicycle().systemd?.enable ?? [];
  for (const unit of units) {
    if ((await isEnabled(unit)) && (await isActive(unit))) continue;
    const r = await $`systemctl enable --now ${unit}`.quiet().nothrow();
    if (r.exitCode !== 0) {
      console.error(`systemd: failed to enable ${unit}: ${r.stderr.toString().trim()}`);
      continue;
    }
    console.log(`systemd: enabled ${unit}`);
  }
};
