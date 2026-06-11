import { $ } from "bun";
import fs from "fs";
import type { Diff } from "@bicycle/shared";
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

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const wanted = config.bicycle().groups ?? [];
  const diffs: Diff[] = [];
  for (const g of wanted) {
    const existing = await lookup(g.name);
    if (!existing) {
      diffs.push({ type: "group", id: g.name, field: "exists", expected: true, actual: false });
    } else if (existing.gid !== g.gid) {
      diffs.push({ type: "group", id: g.name, field: "gid", expected: g.gid, actual: existing.gid });
    }
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = new Map((config.bicycle().groups ?? []).map((g) => [g.name, g]));
  for (const d of await plan()) {
    const g = wanted.get(d.id);
    if (!g) continue;
    if (d.field === "gid") {
      log.warn(
        { group: g.name, wantGid: g.gid, haveGid: d.actual },
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
