import { $ } from "bun";
import fs from "fs";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";

type Existing = { name: string; gid: number };

const lookup = async (name: string): Promise<Existing | null> => {
  const r = await $`getent group ${name}`.quiet().nothrow();
  if (r.exitCode !== 0) return null;
  const line = r.stdout.toString().trim();
  const parts = line.split(":");
  const gid = Number(parts[2]);
  if (!Number.isInteger(gid)) return null;
  return { name: parts[0]!, gid };
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = config.bicycle().groups ?? [];
  for (const g of wanted) {
    const existing = await lookup(g.name);
    if (existing) {
      if (existing.gid === g.gid) continue;
      log.warn(
        { group: g.name, wantGid: g.gid, haveGid: existing.gid },
        "groups: gid mismatch; refusing to modify live group, run 'groupmod -g <gid> <name>' manually",
      );
      continue;
    }
    log.info({ group: g.name, gid: g.gid }, "groups: creating");
    const r = await $`groupadd -g ${g.gid} ${g.name}`.quiet().nothrow();
    if (r.exitCode !== 0) {
      log.error(
        { group: g.name, gid: g.gid, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
        "groups: failed to create",
      );
      continue;
    }
    log.info({ group: g.name, gid: g.gid }, "groups: created");
  }
};
