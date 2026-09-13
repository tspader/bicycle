import { $ } from "bun";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { log } from "../logger";
import { allPasswd, HUMAN_ID_MIN, HUMAN_ID_MAX } from "./users";
import { bin } from "./bin";

type Group = NonNullable<config.BicycleConfig["groups"]>[number];

type Existing = { name: string; gid: number };

type Action =
  | { do: "create"; group: Group }
  | { do: "gid-mismatch"; group: Group; have: number }
  | { do: "undeclared"; name: string; gid: number };

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

const actions = async (): Promise<Action[]> => {
  const cfg = config.maybe();
  if (!cfg) return [];
  const wanted = cfg.groups ?? [];
  const out: Action[] = [];
  for (const g of wanted) {
    const existing = await lookup(g.name);
    if (!existing) out.push({ do: "create", group: g });
    else if (existing.gid !== g.gid) out.push({ do: "gid-mismatch", group: g, have: existing.gid });
  }
  const declared = new Set(wanted.map((g) => g.name));
  const userNames = new Set((await allPasswd()).map((u) => u.name));
  for (const e of await allGroups()) {
    if (e.gid < HUMAN_ID_MIN || e.gid >= HUMAN_ID_MAX) continue;
    if (declared.has(e.name) || userNames.has(e.name)) continue;
    out.push({ do: "undeclared", name: e.name, gid: e.gid });
  }
  return out;
};

const toDiff = (a: Action): Diff => {
  switch (a.do) {
    case "create":
      return { type: "group", id: a.group.name, field: "exists", expected: true, actual: false };
    case "gid-mismatch":
      return { type: "group", id: a.group.name, field: "gid", expected: a.group.gid, actual: a.have };
    case "undeclared":
      return { type: "group", id: a.name, field: "exists", expected: null, actual: true, meta: { gid: a.gid } };
  }
};

export const plan = async (): Promise<Diff[]> => (await actions()).map(toDiff);

const create = async (g: Group): Promise<void> => {
  log.info({ group: g.name, gid: g.gid }, "groups: creating");
  const r = await $`${bin("groupadd")} -g ${g.gid} ${g.name}`.quiet().nothrow();
  if (r.exitCode !== 0) {
    log.error(
      { group: g.name, gid: g.gid, exitCode: r.exitCode, stderr: r.stderr.toString().trim() },
      "groups: failed to create",
    );
    return;
  }
  log.info({ group: g.name, gid: g.gid }, "groups: created");
};

export const all = async (): Promise<void> => {
  for (const a of await actions()) {
    switch (a.do) {
      case "create":
        await create(a.group);
        break;
      case "gid-mismatch":
        log.warn(
          { group: a.group.name, wantGid: a.group.gid, haveGid: a.have },
          "groups: gid mismatch; refusing to modify live group, run 'groupmod -g <gid> <name>' manually",
        );
        break;
      case "undeclared":
        break;
    }
  }
};
