import fs from "fs";
import path from "path";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { env } from "../env";
import { chmodExact, octal } from "../fs";
import { lookupUid, lookupGid } from "../nss";
import { log } from "../logger";
import type { Claims } from "../detect/claims";

type Dir = NonNullable<config.BicycleConfig["dirs"]>[number];

type Fix = {
  owner?: { want: number; have: number };
  group?: { want: number; have: number };
  mode?: { have: number };
};

type Action =
  | { do: "create"; dir: Dir }
  | { do: "fix"; dir: Dir; fix: Fix };

const resolve = (rel: string): string => path.join(env.HOST_ROOT, rel);

const actions = async (): Promise<Action[]> => {
  const cfg = config.maybe();
  if (!cfg) return [];
  const out: Action[] = [];
  for (const d of cfg.dirs ?? []) {
    const dest = resolve(d.path);
    if (!fs.existsSync(dest)) {
      out.push({ do: "create", dir: d });
      continue;
    }
    const st = fs.statSync(dest);
    const fix: Fix = {};
    if (d.owner) {
      const wantUid = await lookupUid(d.owner);
      if (wantUid === null) {
        log.warn({ path: d.path, owner: d.owner }, "dirs: owner unknown; skipping chown");
      } else if (wantUid !== st.uid) {
        fix.owner = { want: wantUid, have: st.uid };
      }
    }
    if (d.group) {
      const wantGid = await lookupGid(d.group);
      if (wantGid === null) {
        log.warn({ path: d.path, group: d.group }, "dirs: group unknown; skipping chgrp");
      } else if (wantGid !== st.gid) {
        fix.group = { want: wantGid, have: st.gid };
      }
    }
    if (d.mode !== undefined) {
      const wantMode = parseInt(d.mode, 8);
      const haveMode = st.mode & 0o7777;
      if (haveMode !== wantMode) fix.mode = { have: haveMode };
    }
    if (fix.owner || fix.group || fix.mode) out.push({ do: "fix", dir: d, fix });
  }
  return out;
};

const toDiffs = (a: Action): Diff[] => {
  if (a.do === "create") {
    return [{ type: "dir", id: a.dir.path, field: "exists", expected: true, actual: false }];
  }
  const diffs: Diff[] = [];
  if (a.fix.owner) {
    diffs.push({ type: "dir", id: a.dir.path, field: "owner", expected: a.fix.owner.want, actual: a.fix.owner.have });
  }
  if (a.fix.group) {
    diffs.push({ type: "dir", id: a.dir.path, field: "group", expected: a.fix.group.want, actual: a.fix.group.have });
  }
  if (a.fix.mode) {
    diffs.push({ type: "dir", id: a.dir.path, field: "mode", expected: a.dir.mode!, actual: octal(a.fix.mode.have) });
  }
  return diffs;
};

export const plan = async (): Promise<Diff[]> => (await actions()).flatMap(toDiffs);

const create = async (d: Dir): Promise<void> => {
  const dest = resolve(d.path);
  try {
    fs.mkdirSync(dest, { recursive: true });
    log.info({ path: d.path, dest }, "dirs: created");
  } catch (e) {
    log.error({ err: e, path: d.path, dest }, "dirs: mkdir failed");
    return;
  }
  if (d.owner || d.group) {
    const wantUid = d.owner ? await lookupUid(d.owner) : null;
    const wantGid = d.group ? await lookupGid(d.group) : null;
    if (d.owner && wantUid === null) {
      log.warn({ path: d.path, owner: d.owner }, "dirs: owner unknown; skipping chown");
    }
    if (d.group && wantGid === null) {
      log.warn({ path: d.path, group: d.group }, "dirs: group unknown; skipping chgrp");
    }
    if (wantUid !== null || wantGid !== null) {
      const st = fs.statSync(dest);
      chown(d, dest, wantUid ?? st.uid, wantGid ?? st.gid);
    }
  }
  if (d.mode !== undefined) chmod(d, dest, parseInt(d.mode, 8));
};

const chown = (d: Dir, dest: string, uid: number, gid: number): void => {
  try {
    fs.chownSync(dest, uid, gid);
    log.info({ path: d.path, uid, gid }, "dirs: chowned");
  } catch (e) {
    log.error({ err: e, path: d.path }, "dirs: chown failed");
  }
};

const chmod = (d: Dir, dest: string, mode: number): void => {
  try {
    chmodExact(dest, mode);
    log.info({ path: d.path, mode: d.mode }, "dirs: chmoded");
  } catch (e) {
    log.error({ err: e, path: d.path }, "dirs: chmod failed");
  }
};

const apply = (a: Extract<Action, { do: "fix" }>): void => {
  const dest = resolve(a.dir.path);
  const st = fs.statSync(dest);
  if (a.fix.owner || a.fix.group) {
    chown(a.dir, dest, a.fix.owner?.want ?? st.uid, a.fix.group?.want ?? st.gid);
  }
  if (a.fix.mode) chmod(a.dir, dest, parseInt(a.dir.mode!, 8));
};

export const all = async (): Promise<void> => {
  for (const a of await actions()) {
    if (a.do === "create") await create(a.dir);
    else apply(a);
  }
};

export const claims = (): Claims => {
  const cfg = config.maybe();
  return { exact: [], prefixes: (cfg?.dirs ?? []).map((d) => d.path) };
};
