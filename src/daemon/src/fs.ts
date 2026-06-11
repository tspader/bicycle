import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export const chmodExact = (target: string, mode: number): void => {
  fs.chmodSync(target, mode);
  if ((mode & 0o7000) === 0) return;
  if ((fs.statSync(target).mode & 0o7777) === mode) return;
  const r = spawnSync("chmod", [mode.toString(8), target]);
  if (r.status !== 0) {
    throw new Error(`chmod ${mode.toString(8)} ${target}: ${r.stderr?.toString().trim()}`);
  }
};

export const chownIgnoreEperm = (target: string, uid: number, gid: number): void => {
  try {
    fs.chownSync(target, uid, gid);
  } catch (e: any) {
    if (e.code !== "EPERM") throw e;
  }
};

const lchownIgnoreEperm = (target: string, uid: number, gid: number): void => {
  try {
    fs.lchownSync(target, uid, gid);
  } catch (e: any) {
    if (e.code !== "EPERM") throw e;
  }
};

export const chownRecursiveIfNeeded = (
  target: string,
  uid: number,
  gid: number,
): void => {
  const st = fs.lstatSync(target);
  if (st.uid !== uid || st.gid !== gid) {
    lchownIgnoreEperm(target, uid, gid);
  }
  if (!st.isDirectory()) return;
  for (const ent of fs.readdirSync(target, { withFileTypes: true })) {
    chownRecursiveIfNeeded(path.join(target, ent.name), uid, gid);
  }
};
