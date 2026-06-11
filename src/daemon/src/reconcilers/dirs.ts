import fs from "fs";
import path from "path";
import type { Diff } from "@bicycle/shared";
import * as config from "../config";
import { env } from "../env";
import { paths } from "../paths";
import { chmodExact } from "../fs";
import { lookupUid, lookupGid } from "../nss";
import { log } from "../logger";

const resolve = (rel: string): string => {
  const hostRoot = env.HOST_ROOT;
  return path.join(hostRoot, rel);
};

const octal = (mode: number): string => `0${mode.toString(8)}`;

export const plan = async (): Promise<Diff[]> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return [];
  const wanted = config.bicycle().dirs ?? [];
  const diffs: Diff[] = [];
  for (const d of wanted) {
    const dest = resolve(d.path);
    if (!fs.existsSync(dest)) {
      diffs.push({ type: "dir", id: d.path, field: "exists", expected: true, actual: false });
      continue;
    }
    const st = fs.statSync(dest);
    if (d.owner) {
      const wantUid = await lookupUid(d.owner);
      if (wantUid === null) {
        log.warn({ path: d.path, owner: d.owner }, "dirs: owner unknown; skipping chown");
      } else if (wantUid !== st.uid) {
        diffs.push({ type: "dir", id: d.path, field: "owner", expected: wantUid, actual: st.uid });
      }
    }
    if (d.group) {
      const wantGid = await lookupGid(d.group);
      if (wantGid === null) {
        log.warn({ path: d.path, group: d.group }, "dirs: group unknown; skipping chgrp");
      } else if (wantGid !== st.gid) {
        diffs.push({ type: "dir", id: d.path, field: "group", expected: wantGid, actual: st.gid });
      }
    }
    if (d.mode !== undefined) {
      const wantMode = parseInt(d.mode, 8);
      const haveMode = st.mode & 0o7777;
      if (haveMode !== wantMode) {
        diffs.push({ type: "dir", id: d.path, field: "mode", expected: d.mode, actual: octal(haveMode) });
      }
    }
  }
  return diffs;
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = new Map((config.bicycle().dirs ?? []).map((d) => [d.path, d]));
  const byDir = new Map<string, Set<string>>();
  for (const diff of await plan()) {
    const fields = byDir.get(diff.id) ?? new Set();
    fields.add(diff.field);
    byDir.set(diff.id, fields);
  }
  for (const [id, fields] of byDir) {
    const d = wanted.get(id);
    if (!d) continue;
    const dest = resolve(d.path);
    let created = false;
    if (fields.has("exists")) {
      try {
        fs.mkdirSync(dest, { recursive: true });
        created = true;
        log.info({ path: d.path, dest }, "dirs: created");
      } catch (e) {
        log.error({ err: e, path: d.path, dest }, "dirs: mkdir failed");
        continue;
      }
    }

    const st = fs.statSync(dest);
    if (created || fields.has("owner") || fields.has("group")) {
      const wantUid = d.owner ? await lookupUid(d.owner) : null;
      const wantGid = d.group ? await lookupGid(d.group) : null;
      if (created && d.owner && wantUid === null) {
        log.warn({ path: d.path, owner: d.owner }, "dirs: owner unknown; skipping chown");
      }
      if (created && d.group && wantGid === null) {
        log.warn({ path: d.path, group: d.group }, "dirs: group unknown; skipping chgrp");
      }
      const newUid = wantUid ?? st.uid;
      const newGid = wantGid ?? st.gid;
      if (newUid !== st.uid || newGid !== st.gid) {
        try {
          fs.chownSync(dest, newUid, newGid);
          log.info({ path: d.path, uid: newUid, gid: newGid }, "dirs: chowned");
        } catch (e) {
          log.error({ err: e, path: d.path }, "dirs: chown failed");
        }
      }
    }

    if (d.mode !== undefined && (created || fields.has("mode"))) {
      const wantMode = parseInt(d.mode, 8);
      try {
        chmodExact(dest, wantMode);
        log.info({ path: d.path, mode: d.mode }, "dirs: chmoded");
      } catch (e) {
        log.error({ err: e, path: d.path }, "dirs: chmod failed");
      }
    }
  }
};
