import fs from "fs";
import path from "path";
import * as config from "../config";
import { env } from "../env";
import { paths } from "../paths";
import { lookupUid, lookupGid } from "../nss";
import { log } from "../logger";

const resolve = (rel: string): string => {
  const hostRoot = env.HOST_ROOT;
  return path.join(hostRoot, rel);
};

export const all = async (): Promise<void> => {
  if (!fs.existsSync(paths.etc.bicycleYaml)) return;
  const wanted = config.bicycle().dirs ?? [];
  for (const d of wanted) {
    const dest = resolve(d.path);
    let created = false;
    if (!fs.existsSync(dest)) {
      try {
        fs.mkdirSync(dest, { recursive: true });
        created = true;
        log.info({ path: d.path, dest }, "dirs: created");
      } catch (e) {
        log.error({ err: e, path: d.path, dest }, "dirs: mkdir failed");
        continue;
      }
    }

    const wantUid = d.owner ? await lookupUid(d.owner) : null;
    const wantGid = d.group ? await lookupGid(d.group) : null;
    if (d.owner && wantUid === null) {
      log.warn({ path: d.path, owner: d.owner }, "dirs: owner unknown; skipping chown");
    }
    if (d.group && wantGid === null) {
      log.warn({ path: d.path, group: d.group }, "dirs: group unknown; skipping chgrp");
    }

    const st = fs.statSync(dest);
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

    if (d.mode !== undefined) {
      const wantMode = parseInt(d.mode, 8);
      const haveMode = st.mode & 0o7777;
      if (created || haveMode !== wantMode) {
        try {
          fs.chmodSync(dest, wantMode);
          log.info({ path: d.path, mode: d.mode }, "dirs: chmoded");
        } catch (e) {
          log.error({ err: e, path: d.path }, "dirs: chmod failed");
        }
      }
    }
  }
};
