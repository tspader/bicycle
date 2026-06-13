import { $ } from "bun";
import fs from "fs";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { paths } from "../paths";
import { log } from "../logger";
import { allPasswd, HUMAN_ID_MIN, HUMAN_ID_MAX } from "./users";
import { bin } from "./bin";

type Existing = { name: string; gid: number };

const allGroups = async (): Promise<Existing[]> => {
  const r = await $`${bin("getent")} group`.quiet().nothrow();
  if (r.exitCode !== 0) return [];
  const out: Existing[] = [];
  for (const line of r.stdout.toString().split("\n")) {
    const parts = line.split(":");
    const gid = Number(parts[2]);
    if (!parts[0] || !Number.isInteger(gid)) continue;
    out.push({ name: parts[0], gid });
  }
  return out;
};

const lookup = async (name: string): Promise<Existing | null> => {
  const r = await $`${bin("getent")} group ${name}`.quiet().nothrow();
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
  const declared = new Set(wanted.map((g) => g.name));
  const userNames = new Set((await allPasswd()).map((u) => u.name));
  for (const e of await allGroups()) {
    if (e.gid < HUMAN_ID_MIN || e.gid >= HUMAN_ID_MAX) continue;
    if (declared.has(e.name) || userNames.has(e.name)) continue;
    diffs.push({
      type: "group",
      id: e.name,
      field: "exists",
      expected: null,
      actual: true,
      meta: { gid: e.gid },
    });
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = new Map((config.bicycle().groups ?? []).map((g) => [g.name, g]));
  for (const d of await plan()) {
    if (d.expected === null) continue;
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
    const r = await $`${bin("groupadd")} -g ${g.gid} ${g.name}`.quiet().nothrow();
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
